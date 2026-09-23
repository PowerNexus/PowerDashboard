import type { AuditFilters } from "@gamedashboard/contracts";
import { activityLogs, type Database } from "@gamedashboard/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedLocation, seedNode, seedServer, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  NO_DATABASE_REASON,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { ActivityService } from "./activity.service";

/**
 * L'export du journal, contre une vraie base.
 *
 * Ce qu'on vérifie vit dans des prédicats SQL : les filtres, et le curseur
 * `(at, id) < (…)` qui découpe l'export en blocs. Une doublure ne dirait rien
 * d'une comparaison de n-uplets ni d'un instant partagé par deux lignes.
 */
describe.skipIf(!HAS_DATABASE)("export du journal (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let activity: ActivityService;
  let alice: string;
  let bruno: string;
  let serverId: string;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    activity = new ActivityService(db);

    alice = await seedUser(db);
    bruno = await seedUser(db);
    const nodeId = await seedNode(db, { locationId: await seedLocation(db) });
    serverId = await seedServer(db, { nodeId, ownerId: alice });

    /*
     * Un jeu varié : deux acteurs, un serveur ou aucun, trois familles
     * d'événements, des adresses différentes — et **des instants partagés**,
     * quatre lignes par seconde. C'est là que le curseur doit départager par
     * l'identifiant, sans perdre ni répéter une ligne entre deux blocs.
     */
    const events = ["account.password_changed", "server.power.start", "backup.create"];
    const rows = Array.from({ length: 60 }, (_, i) => ({
      actorId: i % 2 === 0 ? alice : bruno,
      actorType: "user" as const,
      actorLabel: i % 2 === 0 ? "Alice Durand" : "Bruno Petit",
      serverId: i % 3 === 0 ? null : serverId,
      event: events[i % 3] as string,
      ip: i % 5 === 0 ? "198.51.100.9" : "203.0.113.7",
      properties: { rang: i },
      at: new Date(Date.UTC(2026, 8, 1, 12, 0, Math.floor(i / 4))).toISOString(),
    }));
    await db.insert(activityLogs).values(rows);
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  async function exported(filters: AuditFilters, batchSize: number): Promise<string[]> {
    const ids: string[] = [];
    for await (const e of activity.streamPlatform(filters, batchSize)) ids.push(e.id);
    return ids;
  }

  /** Toutes les pages de l'écran, bout à bout. */
  async function listed(filters: AuditFilters): Promise<string[]> {
    const ids: string[] = [];
    for (let page = 1; ; page += 1) {
      const result = await activity.forPlatform({ ...filters, page });
      ids.push(...result.items.map((e) => e.id));
      if (!result.hasMore) return ids;
    }
  }

  const cas: [string, () => AuditFilters][] = [
    ["sans filtre", () => ({})],
    ["recherche libre sur l'auteur", () => ({ query: "bruno" })],
    ["recherche libre sur l'adresse", () => ({ query: "198.51" })],
    ["préfixe d'événement", () => ({ event: "account." })],
    ["acteur", () => ({ actorId: alice })],
    ["serveur", () => ({ serverId })],
    ["période", () => ({ since: "2026-09-01T12:00:10Z" })],
    [
      "filtres cumulés",
      () => ({ actorId: bruno, event: "server.", since: "2026-09-01T12:00:03Z" }),
    ],
  ];

  it.each(cas)("contient exactement ce que l'écran liste : %s", async (_, filtres) => {
    const filters = filtres();
    const attendu = await listed(filters);
    // Des blocs de 7 : plusieurs reprises de curseur, qui tombent au milieu
    // d'une seconde partagée par quatre lignes.
    const obtenu = await exported(filters, 7);

    expect(attendu.length).toBeGreaterThan(0);
    expect(obtenu).toEqual(attendu);
    expect(new Set(obtenu).size).toBe(obtenu.length);
  });

  it("n'est pas bornée à une page de l'écran", async () => {
    const tout = await exported({}, 500);
    const [{ total } = { total: 0 }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(activityLogs);
    expect(tout.length).toBe(total);
    expect(tout.length).toBeGreaterThan(50);
  });

  it("se trace au journal : qui, quel format, quels filtres", async () => {
    const file = await activity.exportPlatform({
      filters: { event: "backup.", actorId: alice, query: undefined },
      format: "jsonl",
      actor: { id: alice, label: "alice@exemple.fr", ip: "192.0.2.4", userAgent: "essai" },
    });

    // La trace est écrite avant la première ligne, pas à la fin du transfert :
    // un téléchargement interrompu a tout de même eu lieu.
    const [trace] = await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.event, "admin.audit_exported"));
    expect(trace).toMatchObject({
      actorId: alice,
      actorLabel: "alice@exemple.fr",
      serverId: null,
      ip: "192.0.2.4",
      userAgent: "essai",
      properties: { format: "jsonl", filters: { event: "backup.", actorId: alice } },
    });

    let lignes = 0;
    for await (const chunk of file.chunks) {
      const e = JSON.parse(chunk) as { event: string; actorId: string };
      expect(e.event.startsWith("backup.")).toBe(true);
      expect(e.actorId).toBe(alice);
      lignes += 1;
    }
    expect(lignes).toBe((await listed({ event: "backup.", actorId: alice })).length);
  });
});

// Vitest n'affiche pas la raison d'un `skipIf` : on la dit une fois.
if (!HAS_DATABASE) console.warn(NO_DATABASE_REASON);
