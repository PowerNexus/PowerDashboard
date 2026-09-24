import { activityLogs, type Database, serverSubusers, servers, users } from "@gamedashboard/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedLocation, seedNode, seedServer, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { RemoteActivityService, type WingsActivity } from "./remote-activity.service";

/**
 * Journal remonté par le daemon, contre une vraie base (NC-45).
 *
 * Trois défauts, et une vraie base pour chacun :
 *
 * - l'auteur déclaré devait seulement **exister** : un node compromis
 *   attribuait une suppression de fichiers à n'importe quel compte de la
 *   plateforme. Le lien au serveur se lit dans des prédicats SQL, qu'une
 *   doublure ne vérifierait pas ;
 * - l'adresse n'était pas validée : la colonne `inet` refusait la valeur, et
 *   **tout le lot** avec — 500, que Wings rejoue en boucle. Seule une vraie
 *   base PostgreSQL la refuse ;
 * - l'horodatage était libre : une ligne datée de l'an 2999 restait en tête
 *   du journal pour toujours, une ligne de 1970 s'y perdait.
 */
describe.skipIf(!HAS_DATABASE)("RemoteActivityService (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let service: RemoteActivityService;
  let nodeId: string;
  let serverId: string;
  let ownerId: string;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    service = new RemoteActivityService(db);
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(
      sql.raw(
        `truncate table activity_logs, server_subusers, servers, allocations, eggs, nests, nodes, locations, users cascade`,
      ),
    );
    nodeId = await seedNode(db, { locationId: await seedLocation(db) });
    ownerId = await seedUser(db);
    serverId = await seedServer(db, { nodeId, ownerId });
  });

  async function compte(role: "admin" | "support" | "reseller" | "user" = "user") {
    const id = await seedUser(db);
    if (role !== "user") await db.update(users).set({ role }).where(eq(users.id, id));
    return id;
  }

  async function invite(userId: string, accepted: boolean) {
    await db.insert(serverSubusers).values({
      serverId,
      userId,
      permissions: ["files.read", "files.sftp"],
      acceptedAt: accepted ? new Date().toISOString() : null,
    });
  }

  const entree = (over: Partial<WingsActivity>): WingsActivity => ({
    server: serverId,
    event: "server:sftp.write",
    ip: "82.66.14.201",
    timestamp: new Date().toISOString(),
    ...over,
  });

  /** L'auteur retenu pour chaque ligne, repérée par sa métadonnée `qui`. */
  async function auteurs(): Promise<Record<string, string | null>> {
    const rows = await db
      .select({ actorId: activityLogs.actorId, properties: activityLogs.properties })
      .from(activityLogs);
    return Object.fromEntries(rows.map((r) => [(r.properties as { qui: string }).qui, r.actorId]));
  }

  it("n'attribue une action qu'à quelqu'un qui a accès au serveur", async () => {
    const etranger = await compte();
    const invite_ = await compte();
    const enAttente = await compte();
    const admin = await compte("admin");
    const revendeur = await compte("reseller");
    await invite(invite_, true);
    await invite(enAttente, false);
    await db.update(servers).set({ resellerId: revendeur }).where(eq(servers.id, serverId));

    await service.record(nodeId, [
      entree({ user: ownerId, metadata: { qui: "proprietaire" } }),
      entree({ user: invite_, metadata: { qui: "sous-utilisateur" } }),
      // Le personnel ouvre la console d'un client (`ServerAccessService`) :
      // Wings journalise ses commandes sous son identité, et c'est la trace
      // qu'on cherche après coup.
      entree({ user: admin, metadata: { qui: "personnel" } }),
      entree({ user: revendeur, metadata: { qui: "revendeur" } }),
      // Un compte bien réel, mais sans lien avec ce serveur : c'est
      // l'attribution qu'un node compromis voudrait fabriquer.
      entree({ user: etranger, metadata: { qui: "etranger" } }),
      // Une invitation non acceptée ne donne encore aucun accès.
      entree({ user: enAttente, metadata: { qui: "en-attente" } }),
    ]);

    expect(await auteurs()).toEqual({
      proprietaire: ownerId,
      "sous-utilisateur": invite_,
      personnel: admin,
      revendeur,
      etranger: null,
      "en-attente": null,
    });
  });

  it("n'attribue rien au personnel sur le parc d'un revendeur qui le lui ferme", async () => {
    // Même règle que `ServerAccessService` : la plateforme ne voit pas un
    // serveur que son revendeur lui a fermé, elle n'a donc pas pu y agir.
    const admin = await compte("admin");
    const revendeur = await compte("reseller");
    await db.update(users).set({ platformAccess: "none" }).where(eq(users.id, revendeur));
    await db.update(servers).set({ resellerId: revendeur }).where(eq(servers.id, serverId));

    await service.record(nodeId, [entree({ user: admin, metadata: { qui: "personnel" } })]);

    expect(await auteurs()).toEqual({ personnel: null });
  });

  it("garde l'événement, sans auteur, quand l'auteur n'a pas de lien", async () => {
    // Écarter la ligne effacerait une trace : l'écriture a bien eu lieu. Seule
    // l'attribution est refusée.
    await service.record(nodeId, [entree({ user: await compte(), metadata: { qui: "x" } })]);

    const [row] = await db.select().from(activityLogs);
    expect(row).toMatchObject({ actorId: null, actorType: "system", actorLabel: "Daemon" });
  });

  it("ignore une adresse invalide au lieu de refuser tout le lot", async () => {
    await service.record(nodeId, [
      entree({ ip: "pas-une-ip", metadata: { qui: "texte" } }),
      entree({ ip: "82.66.14.201:2022", metadata: { qui: "avec-port" } }),
      // `net.isIP` accepte l'indice de zone ; la colonne `inet`, non.
      entree({ ip: "fe80::1%eth0", metadata: { qui: "zone" } }),
      entree({ ip: "2001:db8::1", metadata: { qui: "ipv6" } }),
      entree({ ip: "82.66.14.201", metadata: { qui: "ipv4" } }),
    ]);

    const rows = await db
      .select({ ip: activityLogs.ip, properties: activityLogs.properties })
      .from(activityLogs);
    const ips = Object.fromEntries(rows.map((r) => [(r.properties as { qui: string }).qui, r.ip]));
    expect(ips).toEqual({
      texte: null,
      "avec-port": null,
      zone: null,
      ipv6: "2001:db8::1",
      ipv4: "82.66.14.201",
    });
  });

  it("borne l'horodatage du daemon", async () => {
    const avant = Date.now();
    const hier = new Date(avant - 24 * 3600_000).toISOString();

    await service.record(nodeId, [
      entree({ timestamp: "2999-01-01T00:00:00Z", metadata: { qui: "futur" } }),
      entree({ timestamp: "1970-01-01T00:00:00Z", metadata: { qui: "passe" } }),
      // Un lot en retard après une coupure garde sa vraie date.
      entree({ timestamp: hier, metadata: { qui: "hier" } }),
    ]);

    const rows = await db
      .select({ at: activityLogs.at, properties: activityLogs.properties })
      .from(activityLogs);
    const at = Object.fromEntries(
      rows.map((r) => [(r.properties as { qui: string }).qui, new Date(r.at).getTime()]),
    );

    // Hors bornes : l'instant de réception, qui est au moins vrai.
    for (const qui of ["futur", "passe"]) {
      expect(at[qui], qui).toBeGreaterThanOrEqual(avant - 1000);
      expect(at[qui], qui).toBeLessThanOrEqual(Date.now() + 1000);
    }
    expect(at.hier).toBe(new Date(hier).getTime());
  });
});
