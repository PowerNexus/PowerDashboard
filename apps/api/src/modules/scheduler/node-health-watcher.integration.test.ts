import { NODE_HEARTBEAT_LOST_MS, type WebhookPayload } from "@gamedashboard/contracts";
import { applicationWebhookDeliveries, type Database, nodes } from "@gamedashboard/db";
import { Logger } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedLocation, seedNode, seedServer, seedUser, seedWebhook } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  NO_DATABASE_REASON,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { WebhookEmitterService } from "../webhooks/webhook-emitter.service";
import { NodeHealthWatcherService } from "./node-health-watcher.service";

/**
 * Le veilleur de nodes, contre une vraie base.
 *
 * Sa logique vit dans des prédicats SQL — des comparaisons de dates et des
 * `is null`. Une doublure de base ne testerait que l'accord de la doublure avec
 * elle-même ; c'est justement là que se logent les erreurs qu'on cherche.
 *
 * L'horloge est passée en paramètre à `tick()`, si bien que dix minutes de
 * panne se simulent en une milliseconde. Aucun test ici n'attend quoi que ce
 * soit : un test qui dort est un test qu'on finit par désactiver.
 *
 * La chaîne testée est complète jusqu'à la file : veilleur → émetteur →
 * livraisons inscrites en base. Seul l'envoi HTTP est hors champ, parce qu'il
 * appartient au répartiteur.
 */
describe.skipIf(!HAS_DATABASE)("NodeHealthWatcherService (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let watcher: NodeHealthWatcherService;
  let locationId: string;

  /** Un instant fixe : les dates du test se lisent alors comme des écarts. */
  const NOW = new Date("2026-03-01T12:00:00.000Z");
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  /** Largement au-delà du seuil, pour qu'un test ne bascule pas sur une seconde. */
  const LONG_SILENCE = NODE_HEARTBEAT_LOST_MS * 5;

  beforeAll(async () => {
    // Le veilleur journalise chaque chute : utile en production, illisible dans
    // une suite qui en provoque quatorze. On le coupe pour ce fichier — Vitest
    // isole chaque fichier dans son propre processus.
    Logger.overrideLogger(false);

    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    // Le vrai émetteur, pas une doublure : le filtrage par événement abonné
    // fait partie de ce qu'on veut voir marcher.
    watcher = new NodeHealthWatcherService(db, new WebhookEmitterService(db));
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    /**
     * Chaque test repart d'un parc vide : l'ordre d'exécution ne doit décider
     * de rien.
     *
     * `truncate … cascade` plutôt qu'une suite de `delete` : les clés
     * étrangères du schéma sont en `restrict`, à dessein — on ne supprime pas
     * un node qui héberge des serveurs. Les respecter ici demanderait de tenir
     * à jour un ordre de suppression qui doublerait le graphe des dépendances,
     * et qui se périmerait à la première table ajoutée.
     */
    await db.execute(
      sql.raw(
        `truncate table servers, allocations, eggs, nests, nodes, locations, users, application_keys cascade`,
      ),
    );
    locationId = await seedLocation(db);
  });

  /** Les livraisons inscrites, de la plus ancienne à la plus récente. */
  async function delivered(): Promise<{ event: string; data: Record<string, unknown> }[]> {
    const rows = await db
      .select({
        event: applicationWebhookDeliveries.event,
        payload: applicationWebhookDeliveries.payload,
      })
      .from(applicationWebhookDeliveries)
      .orderBy(applicationWebhookDeliveries.createdAt, applicationWebhookDeliveries.event);

    return rows.map((row) => ({
      event: row.event,
      data: (row.payload as unknown as WebhookPayload).data,
    }));
  }

  async function markOf(nodeId: string): Promise<string | null> {
    const [row] = await db
      .select({ mark: nodes.unreachableSince })
      .from(nodes)
      .where(eq(nodes.id, nodeId));
    return row?.mark ?? null;
  }

  describe("ce qui ne doit rien déclencher", () => {
    it("ne dit rien d'un node dont le heartbeat est frais", async () => {
      await seedWebhook(db, { events: ["node.unreachable", "node.recovered"] });
      await seedNode(db, { locationId, lastHeartbeatAt: ago(5_000) });

      await watcher.tick(NOW);

      expect(await delivered()).toEqual([]);
    });

    it("ne dit rien d'un node jamais joint", async () => {
      // Machine déclarée dont le daemon n'est pas encore installé : on n'a
      // rien perdu, il n'y a donc rien à signaler. Sans cette règle, la mise
      // en service d'un node produirait une alerte à chaque fois.
      await seedWebhook(db, { events: ["node.unreachable"] });
      const nodeId = await seedNode(db, { locationId, lastHeartbeatAt: null });

      await watcher.tick(NOW);

      expect(await delivered()).toEqual([]);
      expect(await markOf(nodeId)).toBeNull();
    });

    it("ne dit rien à un point d'entrée abonné à d'autres événements", async () => {
      await seedWebhook(db, { events: ["server.installed"] });
      await seedNode(db, { locationId, lastHeartbeatAt: ago(LONG_SILENCE) });

      await watcher.tick(NOW);

      expect(await delivered()).toEqual([]);
    });

    it("ne dit rien à un point d'entrée en pause", async () => {
      await seedWebhook(db, { events: ["node.unreachable"], isActive: false });
      await seedNode(db, { locationId, lastHeartbeatAt: ago(LONG_SILENCE) });

      await watcher.tick(NOW);

      expect(await delivered()).toEqual([]);
    });

    it("marque tout de même le node quand personne n'écoute", async () => {
      // L'absence d'abonné ne doit pas laisser la chute « en attente » : le
      // jour où quelqu'un s'abonne, il ne doit pas recevoir une panne qui a
      // commencé la semaine précédente.
      const nodeId = await seedNode(db, { locationId, lastHeartbeatAt: ago(LONG_SILENCE) });

      await watcher.tick(NOW);

      expect(await markOf(nodeId)).not.toBeNull();
    });
  });

  describe("la chute", () => {
    it("annonce une seule fois, et date la panne du dernier heartbeat", async () => {
      await seedWebhook(db, { events: ["node.unreachable", "node.recovered"] });
      const silence = ago(LONG_SILENCE);
      const nodeId = await seedNode(db, {
        locationId,
        name: "RYZEN-TEST",
        lastHeartbeatAt: silence,
      });

      await watcher.tick(NOW);

      const first = await delivered();
      expect(first).toHaveLength(1);
      expect(first[0]?.event).toBe("node.unreachable");
      expect(first[0]?.data).toMatchObject({ nodeId, name: "RYZEN-TEST", affectedServers: 0 });

      // La marque porte l'instant où le node s'est tu, pas celui du constat :
      // c'est ce qui rend exacte la durée annoncée au retour.
      expect(new Date(String(await markOf(nodeId))).toISOString()).toBe(silence);

      // Deuxième tour, rien de neuf : l'alerte ne se répète pas.
      await watcher.tick(new Date(NOW.getTime() + 60_000));
      expect(await delivered()).toHaveLength(1);
    });

    it("compte les serveurs coupés", async () => {
      await seedWebhook(db, { events: ["node.unreachable"] });
      const ownerId = await seedUser(db);
      const nodeId = await seedNode(db, { locationId, lastHeartbeatAt: ago(LONG_SILENCE) });
      await seedServer(db, { nodeId, ownerId });
      await seedServer(db, { nodeId, ownerId });

      await watcher.tick(NOW);

      const [event] = await delivered();
      // Sans ce chiffre, « un node est tombé » ne permet pas de décider s'il
      // faut réveiller quelqu'un.
      expect(event?.data).toMatchObject({ affectedServers: 2 });
    });

    it("annonce aussi un node en maintenance, en le disant", async () => {
      // Le fait l'emporte sur l'intention, comme dans `nodeStatus` : les
      // serveurs sont réellement injoignables. Le drapeau permet au receveur
      // de distinguer un redémarrage prévu d'une panne.
      await seedWebhook(db, { events: ["node.unreachable"] });
      await seedNode(db, { locationId, lastHeartbeatAt: ago(LONG_SILENCE), maintenance: true });

      await watcher.tick(NOW);

      const [event] = await delivered();
      expect(event?.data).toMatchObject({ maintenance: true });
    });

    it("annonce chaque node tombé, pas seulement le premier", async () => {
      await seedWebhook(db, { events: ["node.unreachable"] });
      await seedNode(db, { locationId, name: "A", lastHeartbeatAt: ago(LONG_SILENCE) });
      await seedNode(db, { locationId, name: "B", lastHeartbeatAt: ago(LONG_SILENCE) });

      await watcher.tick(NOW);

      expect((await delivered()).map((d) => d.data.name).sort()).toEqual(["A", "B"]);
    });

    it("attend le seuil : un heartbeat en retard n'est pas une panne", async () => {
      // Juste en deçà du seuil : le node est « en retard », pas injoignable.
      // Alerter ici transformerait chaque hoquet réseau en incident.
      await seedWebhook(db, { events: ["node.unreachable"] });
      await seedNode(db, { locationId, lastHeartbeatAt: ago(NODE_HEARTBEAT_LOST_MS - 1_000) });

      await watcher.tick(NOW);

      expect(await delivered()).toEqual([]);
    });
  });

  describe("le retour", () => {
    it("annonce le retour et rend la durée complète de la panne", async () => {
      await seedWebhook(db, { events: ["node.unreachable", "node.recovered"] });
      const start = ago(LONG_SILENCE);
      const nodeId = await seedNode(db, {
        locationId,
        lastHeartbeatAt: start,
        // Déjà signalé : on se place au lendemain de la chute.
        unreachableSince: start,
      });

      // Le daemon reparle.
      await db
        .update(nodes)
        .set({ lastHeartbeatAt: ago(1_000) })
        .where(eq(nodes.id, nodeId));

      await watcher.tick(NOW);

      const events = await delivered();
      expect(events).toHaveLength(1);
      expect(events[0]?.event).toBe("node.recovered");
      expect(events[0]?.data).toMatchObject({
        nodeId,
        outageSeconds: LONG_SILENCE / 1000,
      });

      // La marque est levée : l'incident est clos.
      expect(await markOf(nodeId)).toBeNull();
    });

    it("ne se répète pas au tour suivant", async () => {
      await seedWebhook(db, { events: ["node.recovered"] });
      const nodeId = await seedNode(db, {
        locationId,
        lastHeartbeatAt: ago(1_000),
        unreachableSince: ago(LONG_SILENCE),
      });

      await watcher.tick(NOW);
      await watcher.tick(new Date(NOW.getTime() + 60_000));

      expect(await delivered()).toHaveLength(1);
      expect(await markOf(nodeId)).toBeNull();
    });

    it("rouvre un incident si le node retombe", async () => {
      // Le cycle complet : la marque doit pouvoir être reposée après avoir été
      // levée, sinon une seconde panne passerait inaperçue.
      await seedWebhook(db, { events: ["node.unreachable", "node.recovered"] });
      const nodeId = await seedNode(db, {
        locationId,
        lastHeartbeatAt: ago(1_000),
        unreachableSince: ago(LONG_SILENCE),
      });

      await watcher.tick(NOW);

      const later = new Date(NOW.getTime() + LONG_SILENCE);
      await watcher.tick(later);

      const events = await delivered();
      expect(events.map((e) => e.event)).toEqual(["node.recovered", "node.unreachable"]);
      expect(await markOf(nodeId)).not.toBeNull();
    });
  });

  describe("l'amorçage livré en migration", () => {
    it("laisse muet un node tombé avant l'ouverture des abonnements", async () => {
      /**
       * C'est ce que fait `0009_prime_unreachable_nodes.sql` : marquer les
       * machines déjà à terre pour qu'aucune salve ne parte au premier
       * balayage. Le test le rejoue sur un node marqué d'avance, et vérifie la
       * propriété qui compte — un rappel dit ce qui **change**.
       */
      const silence = ago(LONG_SILENCE);
      const nodeId = await seedNode(db, {
        locationId,
        lastHeartbeatAt: silence,
        unreachableSince: silence,
      });
      await seedWebhook(db, { events: ["node.unreachable", "node.recovered"] });

      await watcher.tick(NOW);
      await watcher.tick(new Date(NOW.getTime() + 60_000));

      expect(await delivered()).toEqual([]);
      expect(await markOf(nodeId)).not.toBeNull();
    });
  });
});

// Vitest n'affiche pas la raison d'un `skipIf` : on la dit une fois, sinon une
// suite entièrement sautée ressemble à une suite entièrement verte.
if (!HAS_DATABASE) console.warn(NO_DATABASE_REASON);
