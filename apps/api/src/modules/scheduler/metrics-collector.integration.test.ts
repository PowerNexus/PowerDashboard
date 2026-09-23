import { type Database, serverMetrics } from "@gamedashboard/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedLocation, seedNode, seedServer, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  NO_DATABASE_REASON,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import type { WingsClientService } from "../wings/wings-client.service";
import { MetricsCollectorService } from "./metrics-collector.service";

const GIO = 1024 ** 3;

/**
 * Le relevé d'un serveur ordinaire doit s'écrire.
 *
 * Non-régression : `mem_bytes`, `disk_bytes`, `net_rx` et `net_tx` étaient
 * des `integer` (plafond 2 147 483 647, soit 2 Gio). Un serveur Minecraft
 * banal dépasse ce plafond en disque dès le premier monde, et ses compteurs
 * réseau cumulés en quelques heures. L'insertion échouait, l'échec partait
 * au journal en `debug`, et **aucune ligne n'était écrite** : ces serveurs
 * n'avaient aucun historique, sans que rien ne le signale.
 */
describe.skipIf(!HAS_DATABASE)("relevé des mesures (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  it("écrit un relevé au-delà de 2 Gio de mémoire, de disque et de trafic", async () => {
    const now = new Date("2026-03-01T12:00:00.000Z");
    const locationId = await seedLocation(db);
    const ownerId = await seedUser(db);
    const nodeId = await seedNode(db, { locationId, lastHeartbeatAt: now.toISOString() });
    const serverId = await seedServer(db, { nodeId, ownerId });

    const wings = {
      resources: async () => ({
        state: "running",
        utilization: {
          cpu_absolute: 187.5,
          memory_bytes: 6 * GIO,
          disk_bytes: 48 * GIO,
          network: { rx_bytes: 350 * GIO, tx_bytes: 1200 * GIO },
        },
      }),
    } as unknown as WingsClientService;

    await new MetricsCollectorService(db, wings).tick(now);

    const lignes = await db
      .select()
      .from(serverMetrics)
      .where(eq(serverMetrics.serverId, serverId));
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      memBytes: 6 * GIO,
      diskBytes: 48 * GIO,
      netRx: 350 * GIO,
      netTx: 1200 * GIO,
    });
  });
});

if (!HAS_DATABASE) console.warn(NO_DATABASE_REASON);
