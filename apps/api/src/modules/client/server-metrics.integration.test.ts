import type { MetricsHistoryPoint } from "@gamedashboard/contracts";
import { type Database, serverMetrics, serverSubusers } from "@gamedashboard/db";
import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedLocation, seedNode, seedServer, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  NO_DATABASE_REASON,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import type { AuthenticatedRequest } from "../auth/session.guard";
import { ServerAccessService } from "./server-access.service";
import { ServerMetricsController } from "./server-metrics.controller";
import { ServerMetricsService } from "./server-metrics.service";

/**
 * L'historique des mesures, contre une vraie base.
 *
 * Tout ce qui compte ici vit dans la requête : l'alignement de `date_bin`, les
 * `filter (where …)`, la jointure externe qui laisse les trous nuls, le `lag`
 * des compteurs réseau. Une doublure ne dirait rien de tout cela.
 *
 * L'horloge est passée au service : trente jours de mesures s'écrivent en une
 * insertion, et aucun test n'attend.
 */
describe.skipIf(!HAS_DATABASE)("historique des mesures d'un serveur (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let service: ServerMetricsService;
  let controller: ServerMetricsController;
  let ownerId: string;
  let serverId: string;
  let nodeId: string;

  /** Un instant fixe, au milieu d'un pas de cinq minutes. */
  const NOW = new Date("2026-03-01T12:02:30.000Z");
  const at = (iso: string) => new Date(`2026-03-01T${iso}.000Z`).toISOString();

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    service = new ServerMetricsService(db);
    controller = new ServerMetricsController(new ServerAccessService(db), service);
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(
      sql.raw(
        `truncate table server_metrics, server_subusers, servers, allocations, eggs, nests, nodes, locations, users cascade`,
      ),
    );
    const locationId = await seedLocation(db);
    ownerId = await seedUser(db);
    nodeId = await seedNode(db, { locationId, lastHeartbeatAt: NOW.toISOString() });
    serverId = await seedServer(db, { nodeId, ownerId });
  });

  /** Un relevé tel que l'écrit le collecteur, avec des valeurs neutres par défaut. */
  async function releve(
    instant: string,
    valeurs: Partial<{
      state: string;
      cpuPct: number;
      memBytes: number;
      diskBytes: number;
      netRx: number;
      netTx: number;
      players: number | null;
      serverId: string;
    }> = {},
  ): Promise<void> {
    await db.insert(serverMetrics).values({
      serverId: valeurs.serverId ?? serverId,
      at: instant,
      state: valeurs.state ?? "running",
      cpuPct: valeurs.cpuPct ?? 0,
      memBytes: valeurs.memBytes ?? 0,
      diskBytes: valeurs.diskBytes ?? 0,
      netRx: valeurs.netRx ?? 0,
      netTx: valeurs.netTx ?? 0,
      players: valeurs.players ?? null,
    });
  }

  function pas(points: MetricsHistoryPoint[], debut: string): MetricsHistoryPoint {
    const point = points.find((p) => p.at === debut);
    if (!point) throw new Error(`aucun pas ne commence à ${debut}`);
    return point;
  }

  function requete(userId: string, scopes: string[] | null = null): AuthenticatedRequest {
    return { user: { id: userId }, scopes } as unknown as AuthenticatedRequest;
  }

  describe("l'agrégation", () => {
    it("rend tous les pas de la plage, alignés et ordonnés", async () => {
      const history = await service.history(serverId, "24h", NOW);

      expect(history.stepSeconds).toBe(300);
      expect(history.points).toHaveLength(288);
      // Le dernier pas est celui qui contient l'instant : 12 h 00 pour 12 h 02.
      expect(history.points.at(-1)?.at).toBe(at("12:00:00"));
      expect(history.points[0]?.at).toBe(history.from);
      const ecarts = history.points
        .slice(1)
        .map((p, i) => Date.parse(p.at) - Date.parse(history.points[i]?.at ?? ""));
      expect(new Set(ecarts)).toEqual(new Set([300_000]));
    });

    it("moyenne et maximum du processeur et de la mémoire, par pas", async () => {
      const cpus = [10, 20, 30, 40, 50];
      for (const [i, cpu] of cpus.entries()) {
        await releve(at(`11:5${i}:00`), { cpuPct: cpu, memBytes: (i + 1) * 100_000_000 });
      }

      const history = await service.history(serverId, "24h", NOW);
      const point = pas(history.points, at("11:50:00"));

      expect(point.samples).toBe(5);
      expect(point.cpuAvgPct).toBeCloseTo(30);
      expect(point.cpuMaxPct).toBeCloseTo(50);
      expect(point.memoryAvgBytes).toBe(300_000_000);
      expect(point.memoryMaxBytes).toBe(500_000_000);
    });

    it("déduit un débit des compteurs cumulés de Wings", async () => {
      // 6 000 octets de plus chaque minute : 100 octets par seconde.
      for (let i = 0; i < 5; i++) {
        await releve(at(`11:5${i}:00`), { netRx: 50_000 + i * 6_000, netTx: i * 3_000 });
      }

      const point = pas((await service.history(serverId, "24h", NOW)).points, at("11:50:00"));

      expect(point.networkRxBytesPerSec).toBeCloseTo(100);
      expect(point.networkTxBytesPerSec).toBeCloseTo(50);
    });

    it("ignore la remise à zéro d'un compteur au redémarrage", async () => {
      await releve(at("11:50:00"), { netRx: 900_000 });
      await releve(at("11:51:00"), { netRx: 906_000 });
      // Le conteneur a redémarré : le compteur repart de presque rien. L'écart
      // négatif n'est pas un débit, et le compter ferait une moyenne absurde.
      await releve(at("11:52:00"), { netRx: 1_000 });
      await releve(at("11:53:00"), { netRx: 7_000 });

      const point = pas((await service.history(serverId, "24h", NOW)).points, at("11:50:00"));

      expect(point.networkRxBytesPerSec).toBeCloseTo(100);
    });

    it("rend les joueurs quand la table les porte, et rien sinon", async () => {
      await releve(at("11:50:00"), { players: 4 });
      await releve(at("11:51:00"), { players: 8 });
      await releve(at("11:45:00"), { players: null });

      const history = await service.history(serverId, "24h", NOW);

      expect(pas(history.points, at("11:50:00"))).toMatchObject({ playersAvg: 6, playersMax: 8 });
      expect(pas(history.points, at("11:45:00"))).toMatchObject({
        samples: 1,
        playersAvg: null,
        playersMax: null,
      });
    });

    it("ne mélange pas les serveurs", async () => {
      const autre = await seedServer(db, { nodeId, ownerId });
      await releve(at("11:50:00"), { cpuPct: 90, serverId: autre });
      await releve(at("11:50:00"), { cpuPct: 10 });

      const point = pas((await service.history(serverId, "24h", NOW)).points, at("11:50:00"));

      expect(point).toMatchObject({ samples: 1, cpuMaxPct: 10 });
    });

    it("ne lit rien hors de la plage", async () => {
      await releve("2026-02-27T12:00:00.000Z", { cpuPct: 99 });
      await releve("2026-03-01T12:05:00.000Z", { cpuPct: 99 });

      const history = await service.history(serverId, "24h", NOW);

      expect(history.points.every((p) => p.samples === 0)).toBe(true);
    });

    it("agrège trente jours en 180 pas de quatre heures", async () => {
      await releve("2026-02-10T09:30:00.000Z", { cpuPct: 20 });
      await releve("2026-02-10T11:59:00.000Z", { cpuPct: 60 });

      const history = await service.history(serverId, "30d", NOW);

      expect(history.points).toHaveLength(180);
      expect(pas(history.points, "2026-02-10T08:00:00.000Z")).toMatchObject({
        samples: 2,
        cpuMaxPct: 60,
      });
      expect(pas(history.points, "2026-02-10T08:00:00.000Z").cpuAvgPct).toBeCloseTo(40);
    });
  });

  describe("les trous", () => {
    it("laisse nul un pas sans relevé, au lieu d'y écrire zéro", async () => {
      await releve(at("11:40:00"), { cpuPct: 25, memBytes: 1_000, diskBytes: 5_000 });
      // 11 h 45 : le node s'est tu, aucun relevé.
      await releve(at("11:50:00"), { cpuPct: 35, memBytes: 1_000, diskBytes: 5_000 });

      const trou = pas((await service.history(serverId, "24h", NOW)).points, at("11:45:00"));

      expect(trou).toEqual({
        at: at("11:45:00"),
        samples: 0,
        cpuAvgPct: null,
        cpuMaxPct: null,
        memoryAvgBytes: null,
        memoryMaxBytes: null,
        diskBytes: null,
        networkRxBytesPerSec: null,
        networkTxBytesPerSec: null,
        playersAvg: null,
        playersMax: null,
      });
    });

    it("fait d'un serveur arrêté un trou de charge, mais garde son disque", async () => {
      // Wings répond pour un serveur arrêté, avec des zéros : ce n'est pas un
      // serveur au repos, c'est un serveur qui ne tourne pas.
      for (let i = 0; i < 3; i++) {
        await releve(at(`11:5${i}:00`), {
          state: "offline",
          cpuPct: 0,
          memBytes: 0,
          diskBytes: 7_000_000,
          netRx: 0,
        });
      }

      const point = pas((await service.history(serverId, "24h", NOW)).points, at("11:50:00"));

      expect(point).toMatchObject({
        samples: 3,
        cpuAvgPct: null,
        cpuMaxPct: null,
        memoryAvgBytes: null,
        networkRxBytesPerSec: null,
        diskBytes: 7_000_000,
      });
    });

    it("ne tire pas de débit à travers un silence", async () => {
      // Vingt minutes sans relevé entre deux compteurs : diviser l'écart par
      // ce silence inventerait un débit moyen sur une période non observée.
      await releve(at("11:30:00"), { netRx: 0 });
      await releve(at("11:50:00"), { netRx: 1_200_000 });

      const point = pas((await service.history(serverId, "24h", NOW)).points, at("11:50:00"));

      expect(point.samples).toBe(1);
      expect(point.networkRxBytesPerSec).toBeNull();
    });
  });

  describe("l'accès", () => {
    it("répond au propriétaire", async () => {
      const reponse = await controller.history(requete(ownerId), serverId, "1h");
      expect(reponse.data.points).toHaveLength(60);
    });

    it("répond « introuvable » à un inconnu", async () => {
      const inconnu = await seedUser(db);
      await expect(controller.history(requete(inconnu), serverId, "1h")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("refuse un sous-utilisateur sans « console.read »", async () => {
      const invite = await seedUser(db);
      await db.insert(serverSubusers).values({
        serverId,
        userId: invite,
        permissions: ["files.read"],
        acceptedAt: NOW.toISOString(),
      });

      await expect(controller.history(requete(invite), serverId, "1h")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("répond à un sous-utilisateur qui a « console.read »", async () => {
      const invite = await seedUser(db);
      await db.insert(serverSubusers).values({
        serverId,
        userId: invite,
        permissions: ["console.read"],
        acceptedAt: NOW.toISOString(),
      });

      const reponse = await controller.history(requete(invite), serverId, "7d");
      expect(reponse.data.points).toHaveLength(168);
    });

    it("refuse une clé d'API sans la portée, même celle du propriétaire", async () => {
      await expect(
        controller.history(requete(ownerId, ["files.read"]), serverId, "1h"),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("refuse une plage inconnue plutôt que d'en servir une autre", async () => {
      await expect(controller.history(requete(ownerId), serverId, "90d")).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});

// Vitest n'affiche pas la raison d'un `skipIf` : on la dit une fois.
if (!HAS_DATABASE) console.warn(NO_DATABASE_REASON);
