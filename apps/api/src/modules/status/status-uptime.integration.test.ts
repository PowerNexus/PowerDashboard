import { NODE_HEARTBEAT_LOST_MS } from "@gamedashboard/contracts";
import { type Database, nodeOutages, nodes } from "@gamedashboard/db";
import { Logger } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedLocation, seedNode, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import type { NotificationsService } from "../notifications/notifications.service";
import { NodeHealthWatcherService } from "../scheduler/node-health-watcher.service";
import { WebhookEmitterService } from "../webhooks/webhook-emitter.service";
import { StatusService } from "./status.service";

/**
 * Disponibilité publiée sur la page de statut.
 *
 * La page n'affichait aucun pourcentage faute d'historique. La veille des
 * nodes consigne désormais chaque panne, et la page calcule la disponibilité
 * sur ce qui a été consigné, en disant depuis quand.
 */
describe.skipIf(!HAS_DATABASE)("page de statut : disponibilité (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let locationId: string;

  const jours = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

  beforeAll(async () => {
    Logger.overrideLogger(false);
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(sql.raw("truncate table node_outages, nodes, locations, users cascade"));
    locationId = await seedLocation(db);
  });

  it("retire les pannes consignées, sur la période consignée", async () => {
    const nodeId = await seedNode(db, { locationId });
    await db
      .update(nodes)
      .set({ uptimeTrackedSince: jours(10) })
      .where(eq(nodes.id, nodeId));
    await db.insert(nodeOutages).values({ nodeId, startedAt: jours(5), endedAt: jours(4) });

    const [composant] = (await new StatusService(db).report()).components;
    expect(composant?.uptime.ratio).toBeCloseTo(0.9, 3);
    // Le début de la fenêtre est celui de la consignation, à la seconde près.
    expect(
      Math.abs(new Date(composant?.uptime.since ?? 0).getTime() - Date.parse(jours(10))),
    ).toBeLessThan(5_000);
  });

  it("ne remonte pas au-delà de 90 jours", async () => {
    const nodeId = await seedNode(db, { locationId });
    await db
      .update(nodes)
      .set({ uptimeTrackedSince: jours(400) })
      .where(eq(nodes.id, nodeId));
    // Une panne ancienne, hors fenêtre, ne compte pas.
    await db.insert(nodeOutages).values({ nodeId, startedAt: jours(200), endedAt: jours(199) });

    const [composant] = (await new StatusService(db).report()).components;
    expect(composant?.uptime.ratio).toBe(1);
  });

  it("ne publie pas l'historique d'un node de revendeur", async () => {
    await seedNode(db, { locationId, ownerId: await seedUser(db) });
    expect((await new StatusService(db).report()).components).toEqual([]);
  });

  it("la veille des nodes ouvre et ferme la panne consignée", async () => {
    const maintenant = new Date();
    const silence = new Date(maintenant.getTime() - NODE_HEARTBEAT_LOST_MS * 5).toISOString();
    const nodeId = await seedNode(db, { locationId, lastHeartbeatAt: silence });
    const veille = new NodeHealthWatcherService(db, new WebhookEmitterService(db), {
      notify: async () => undefined,
    } as unknown as NotificationsService);

    await veille.tick(maintenant);
    let [panne] = await db.select().from(nodeOutages).where(eq(nodeOutages.nodeId, nodeId));
    expect(panne).toMatchObject({ endedAt: null });
    expect(new Date(panne?.startedAt ?? 0).toISOString()).toBe(new Date(silence).toISOString());

    await db
      .update(nodes)
      .set({ lastHeartbeatAt: maintenant.toISOString() })
      .where(eq(nodes.id, nodeId));
    await veille.tick(maintenant);
    [panne] = await db.select().from(nodeOutages).where(eq(nodeOutages.nodeId, nodeId));
    expect(panne?.endedAt).not.toBeNull();
  });
});
