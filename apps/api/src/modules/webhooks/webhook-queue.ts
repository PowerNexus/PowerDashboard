import {
  applicationWebhookDeliveries,
  applicationWebhooks,
  type Database,
  webhookDeliveries,
  webhooks,
} from "@gamedashboard/db";
import { and, asc, eq, inArray, isNotNull, lte } from "drizzle-orm";

/**
 * Les deux files de rappels sortants, vues d'un même répartiteur.
 *
 * Il y en a deux parce qu'elles ne s'adressent pas au même monde : l'une porte
 * les événements de toute la plateforme vers un système tiers — la boutique,
 * la facturation — et l'autre les événements d'**un** serveur vers son
 * propriétaire. Les mêler donnerait à un client la liste des comptes.
 *
 * Mais ce qui les distingue s'arrête au destinataire. La signature, les délais
 * de reprise, la règle d'abandon, le format de l'en-tête de livraison : tout
 * cela est identique, et c'est exactement le genre de chose qui diverge
 * silencieusement quand on l'écrit deux fois. Un jour l'une réessaie six fois
 * et l'autre cinq, et plus personne ne sait laquelle a raison.
 *
 * Le répartiteur tient donc le raisonnement, et chaque file ne fournit que sa
 * persistance : lire les échéances, écrire une reprise, clore une livraison.
 */

/** Une livraison prête à partir, indépendamment de la file d'où elle vient. */
export interface DueDelivery {
  id: string;
  event: string;
  payload: Record<string, unknown>;
  attempts: number;
  url: string;
  secretEnc: string;
  webhookId: string;
}

export interface SettleInput {
  attempts: number;
  status: number | null;
  excerpt: string | null;
}

export interface WebhookQueue {
  /** Pour les journaux : « applicatif » ou « client ». */
  readonly label: string;

  /**
   * Prend les livraisons dues, et les retire de la file dans le même geste.
   *
   * `next_attempt_at` passe à `null` au moment de la prise : sans cela, deux
   * instances liraient la même ligne et le destinataire recevrait deux fois le
   * même rappel. La date est réécrite si une reprise s'impose.
   *
   * Conséquence à connaître : une instance tuée entre la prise et l'envoi perd
   * la livraison. C'est le compromis inverse du double envoi, et c'est le bon —
   * un rappel manquant se rattrape en interrogeant l'API, un rappel dupliqué
   * peut se traduire par une seconde facture.
   */
  claimDue(now: Date, limit: number): Promise<DueDelivery[]>;

  /** Repousse la livraison à plus tard. */
  retry(id: string, input: SettleInput, at: Date): Promise<void>;

  /** Clôt la livraison, livrée ou abandonnée. */
  settle(id: string, input: SettleInput, outcome: "delivered" | "abandoned"): Promise<void>;

  /**
   * Note la santé du point d'entrée, quand la file la suit.
   *
   * La file applicative tient deux dates — dernière réussite, dernier échec —
   * parce que l'administration doit pouvoir repérer une intégration qui marche
   * une fois sur deux. La file d'un client ne les tient pas : son écran montre
   * l'historique des livraisons, qui dit la même chose en plus précis.
   */
  touch(webhookId: string, success: boolean): Promise<void>;
}

export function applicationQueue(db: Database): WebhookQueue {
  return {
    label: "applicatif",

    async claimDue(now, limit) {
      const rows = await db
        .select({
          id: applicationWebhookDeliveries.id,
          event: applicationWebhookDeliveries.event,
          payload: applicationWebhookDeliveries.payload,
          attempts: applicationWebhookDeliveries.attempts,
          url: applicationWebhooks.url,
          secretEnc: applicationWebhooks.secretEnc,
          webhookId: applicationWebhooks.id,
        })
        .from(applicationWebhookDeliveries)
        .innerJoin(
          applicationWebhooks,
          eq(applicationWebhookDeliveries.webhookId, applicationWebhooks.id),
        )
        .where(
          and(
            isNotNull(applicationWebhookDeliveries.nextAttemptAt),
            lte(applicationWebhookDeliveries.nextAttemptAt, now.toISOString()),
            // Un point d'entrée désactivé pendant qu'une livraison attendait ne
            // doit plus être appelé : on a coupé le robinet, pas seulement
            // fermé le suivant.
            eq(applicationWebhooks.isActive, true),
          ),
        )
        .orderBy(asc(applicationWebhookDeliveries.nextAttemptAt))
        .limit(limit);

      if (rows.length === 0) return [];

      await db
        .update(applicationWebhookDeliveries)
        .set({ nextAttemptAt: null })
        .where(
          inArray(
            applicationWebhookDeliveries.id,
            rows.map((row) => row.id),
          ),
        );

      return rows;
    },

    async retry(id, input, at) {
      await db
        .update(applicationWebhookDeliveries)
        .set({
          attempts: input.attempts,
          responseStatus: input.status,
          responseBody: input.excerpt,
          nextAttemptAt: at.toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(applicationWebhookDeliveries.id, id));
    },

    async settle(id, input, outcome) {
      const now = new Date().toISOString();
      await db
        .update(applicationWebhookDeliveries)
        .set({
          attempts: input.attempts,
          responseStatus: input.status,
          responseBody: input.excerpt,
          // `null` : plus rien à tenter, dans les deux cas. C'est la colonne
          // qui fait la file, et une ligne close n'y a plus sa place.
          nextAttemptAt: null,
          deliveredAt: outcome === "delivered" ? now : null,
          abandonedAt: outcome === "abandoned" ? now : null,
          updatedAt: now,
        })
        .where(eq(applicationWebhookDeliveries.id, id));
    },

    async touch(webhookId, success) {
      const now = new Date().toISOString();
      await db
        .update(applicationWebhooks)
        .set(success ? { lastSuccessAt: now } : { lastFailureAt: now })
        .where(eq(applicationWebhooks.id, webhookId))
        .catch(() => undefined);
    },
  };
}

export function clientQueue(db: Database): WebhookQueue {
  return {
    label: "client",

    async claimDue(now, limit) {
      const rows = await db
        .select({
          id: webhookDeliveries.id,
          event: webhookDeliveries.event,
          payload: webhookDeliveries.payload,
          attempts: webhookDeliveries.attempts,
          url: webhooks.url,
          secretEnc: webhooks.secretEnc,
          webhookId: webhooks.id,
        })
        .from(webhookDeliveries)
        .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
        .where(
          and(
            isNotNull(webhookDeliveries.nextAttemptAt),
            lte(webhookDeliveries.nextAttemptAt, now.toISOString()),
            eq(webhooks.isActive, true),
          ),
        )
        .orderBy(asc(webhookDeliveries.nextAttemptAt))
        .limit(limit);

      if (rows.length === 0) return [];

      await db
        .update(webhookDeliveries)
        .set({ nextAttemptAt: null })
        .where(
          inArray(
            webhookDeliveries.id,
            rows.map((row) => row.id),
          ),
        );

      return rows;
    },

    async retry(id, input, at) {
      await db
        .update(webhookDeliveries)
        .set({
          attempts: input.attempts,
          responseStatus: input.status,
          responseBody: input.excerpt,
          nextAttemptAt: at.toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(webhookDeliveries.id, id));
    },

    async settle(id, input, outcome) {
      const now = new Date().toISOString();
      await db
        .update(webhookDeliveries)
        .set({
          attempts: input.attempts,
          responseStatus: input.status,
          responseBody: input.excerpt,
          nextAttemptAt: null,
          deliveredAt: outcome === "delivered" ? now : null,
          abandonedAt: outcome === "abandoned" ? now : null,
          updatedAt: now,
        })
        .where(eq(webhookDeliveries.id, id));
    },

    /* La file d'un client ne suit pas de santé : son écran montre l'historique. */
    async touch() {
      return;
    },
  };
}
