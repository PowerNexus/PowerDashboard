import {
  allocations,
  type Database,
  eggs,
  serverHealth,
  serverMetrics,
  servers,
} from "@gamedashboard/db";
import { Logger } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { serveurA2s } from "../../test/a2s-frames";
import { seedLocation, seedNode, seedServer, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import type { NotificationsService } from "../notifications/notifications.service";
import { GameProbeService } from "./game-probe.service";

/**
 * Alerte quand un serveur tombe ou revient.
 *
 * La sonde de jeu écrivait « injoignable » chaque minute sans que rien ne le
 * lise : un serveur figé restait « en marche » pour le panel, et c'étaient
 * les joueurs qui prévenaient son propriétaire.
 */

interface Cible {
  id: string;
  name: string;
  host: string;
  port: number;
}

describe.skipIf(!HAS_DATABASE)("sonde de jeu : pannes et retours (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let serverId: string;
  let sonde: GameProbeService;
  let cible: Cible;
  const notifyServerOwner = vi.fn(async () => {});

  const alerter = (now: Date) =>
    (sonde as unknown as { alert: (t: Cible[], n: Date) => Promise<void> }).alert([cible], now);
  const oublier = (running: string[]) =>
    (sonde as unknown as { forgetStopped: (r: string[]) => Promise<void> }).forgetStopped(running);
  const sondes = async (...resultats: boolean[]) => {
    // Du plus ancien au plus récent, une minute d'écart.
    for (const reachable of resultats) {
      await db.insert(serverHealth).values({
        serverId,
        reachable,
        at: new Date(Date.UTC(2026, 8, 25, 10, minute++, 30)).toISOString(),
      });
    }
  };
  let minute = 0;
  // Juste après la dernière sonde posée : elles sont toutes dans la fenêtre.
  const maintenant = () => new Date(Date.UTC(2026, 8, 25, 10, minute));
  const depuis = async () =>
    (
      await db.select({ s: servers.unreachableSince }).from(servers).where(eq(servers.id, serverId))
    )[0]?.s ?? null;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(
      sql.raw(
        "truncate table server_health, servers, allocations, eggs, nests, nodes, locations, users cascade",
      ),
    );
    minute = 0;
    notifyServerOwner.mockClear();
    const nodeId = await seedNode(db, { locationId: await seedLocation(db) });
    serverId = await seedServer(db, { nodeId, ownerId: await seedUser(db) });
    cible = { id: serverId, name: "Survie", host: "127.0.0.3", port: 25565 };
    sonde = new GameProbeService(db, { notifyServerOwner } as unknown as NotificationsService);
  });

  it("ne prévient pas sur une sonde manquée isolée", async () => {
    await sondes(true, true, false);
    await alerter(maintenant());
    expect(notifyServerOwner).not.toHaveBeenCalled();
    expect(await depuis()).toBeNull();
  });

  it("prévient une fois après trois sondes manquées, pas à chaque tour", async () => {
    await sondes(false, false, false);
    await alerter(maintenant());
    await sondes(false);
    await alerter(maintenant());

    expect(notifyServerOwner).toHaveBeenCalledTimes(1);
    expect(notifyServerOwner).toHaveBeenCalledWith(
      serverId,
      expect.objectContaining({ type: "server.unreachable", level: "danger" }),
    );
    expect(await depuis()).not.toBeNull();
  });

  it("annonce le retour à la première réponse, avec la durée de la panne", async () => {
    await sondes(false, false, false);
    await alerter(new Date("2026-09-25T10:03:00Z"));
    minute = 44;
    await sondes(true);
    await alerter(new Date("2026-09-25T10:45:00Z"));

    expect(notifyServerOwner).toHaveBeenLastCalledWith(
      serverId,
      expect.objectContaining({
        type: "server.recovered",
        body: expect.stringContaining("42 min"),
      }),
    );
    expect(await depuis()).toBeNull();
  });

  it("lève sans bruit la panne d'un serveur arrêté", async () => {
    await sondes(false, false, false);
    await alerter(maintenant());
    notifyServerOwner.mockClear();

    await oublier([]);
    expect(await depuis()).toBeNull();
    expect(notifyServerOwner).not.toHaveBeenCalled();
  });

  it("ignore des échecs anciens, antérieurs à un arrêt", async () => {
    await sondes(false, false);
    minute += 60;
    await sondes(false);
    await alerter(maintenant());
    expect(notifyServerOwner).not.toHaveBeenCalled();
  });

  it("garde la panne d'un serveur toujours censé tourner", async () => {
    await sondes(false, false, false);
    await alerter(maintenant());

    await oublier([serverId]);
    expect(await depuis()).not.toBeNull();
  });
});

/**
 * Les mêmes alertes pour un jeu Steam : la sonde A2S passe par le même tour,
 * la même table et les mêmes transitions que Minecraft.
 */
describe.skipIf(!HAS_DATABASE)("sonde de jeu : serveur A2S (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let serverId: string;
  let sonde: GameProbeService;
  const notifyServerOwner = vi.fn(async () => {});

  beforeAll(async () => {
    Logger.overrideLogger(false);
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(
      sql.raw(
        "truncate table server_health, server_metrics, servers, allocations, eggs, nests, nodes, locations, users cascade",
      ),
    );
    notifyServerOwner.mockClear();
    const nodeId = await seedNode(db, { locationId: await seedLocation(db) });
    serverId = await seedServer(db, { nodeId, ownerId: await seedUser(db) });
    sonde = new GameProbeService(db, { notifyServerOwner } as unknown as NotificationsService);
  });

  /** Le serveur devient un serveur Rust qui tourne, sur le port du faux serveur A2S. */
  async function rust(port: number): Promise<void> {
    const [row] = await db
      .select({ eggId: servers.eggId, allocationId: servers.allocationId })
      .from(servers)
      .where(eq(servers.id, serverId));
    if (!row) throw new Error("serveur introuvable");
    await db.update(eggs).set({ name: "Rust" }).where(eq(eggs.id, row.eggId));
    await db.update(allocations).set({ port }).where(eq(allocations.id, row.allocationId));
    await db.insert(serverMetrics).values({
      serverId,
      at: new Date().toISOString(),
      state: "running",
      cpuPct: 0,
      memBytes: 0,
      diskBytes: 0,
      netRx: 0,
      netTx: 0,
    });
  }

  it("écrit l'état lu par A2S, puis prévient quand le serveur se tait", async () => {
    const serveur = await serveurA2s({ joueurs: ["Alice", "Jean Dupont"] });
    await rust(serveur.port);
    const debut = Date.now();
    const tour = (n: number) => sonde.tick(new Date(debut + n * 60_000));

    await tour(0);
    const [premiere] = await db
      .select({ reachable: serverHealth.reachable, payload: serverHealth.queryPayload })
      .from(serverHealth)
      .where(eq(serverHealth.serverId, serverId));
    expect(premiere).toEqual({
      reachable: true,
      payload: {
        playersOnline: 3,
        playersMax: 100,
        version: "2590",
        sample: ["Alice", "Jean Dupont"],
        name: "Rust FR #1",
        map: "Procedural Map",
      },
    });

    // Le serveur se tait : trois tours manqués font une alerte, une seule.
    await serveur.fermer();
    for (const n of [1, 2, 3, 4]) await tour(n);

    expect(notifyServerOwner).toHaveBeenCalledTimes(1);
    expect(notifyServerOwner).toHaveBeenCalledWith(
      serverId,
      expect.objectContaining({ type: "server.unreachable", level: "danger" }),
    );
    const [etat] = await db
      .select({ since: servers.unreachableSince })
      .from(servers)
      .where(eq(servers.id, serverId));
    expect(etat?.since).not.toBeNull();
  }, 30_000);
});
