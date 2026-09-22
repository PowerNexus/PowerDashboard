import { randomUUID } from "node:crypto";
import type { WebhookEvent, WebhookPayload } from "@gamedashboard/contracts";
import {
  applicationKeys,
  applicationWebhookDeliveries,
  applicationWebhooks,
  type Database,
  nodes,
  servers,
} from "@gamedashboard/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, arrayContains, eq, isNull, or, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * À qui un événement appartient, quand l'objet concerné a déjà disparu.
 *
 * `null` veut dire « à la plateforme » — c'est une réponse, pas une absence de
 * réponse. Ne rien passer veut dire « déduis-le », ce qui est le cas courant.
 */
export interface WebhookScope {
  readonly reseller: string | null;
}

/**
 * Publication d'un événement vers les systèmes tiers abonnés.
 *
 * Deux temps séparés, et c'est le point important : émettre **inscrit** une
 * livraison, il n'envoie rien. L'envoi appartient au répartiteur. Sans cette
 * séparation, créer un serveur attendrait la réponse de la boutique — et un
 * receveur lent ferait expirer une création qui, elle, a parfaitement réussi.
 */
@Injectable()
export class WebhookEmitterService {
  private readonly logger = new Logger(WebhookEmitterService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Inscrit l'événement pour chaque point d'entrée abonné.
   *
   * **N'échoue jamais**, comme le journal d'audit : un rappel qu'on n'a pas su
   * inscrire ne doit pas annuler l'action qu'il décrit. Refuser une création de
   * serveur parce que la table des livraisons est pleine transformerait un
   * problème d'intégration en panne de service.
   *
   * La conséquence est assumée : il peut manquer un rappel. C'est pour cela que
   * l'API applicative reste interrogeable — le rappel accélère, il ne remplace
   * pas la lecture.
   */
  async emit(
    event: WebhookEvent,
    data: Record<string, unknown>,
    /**
     * Le périmètre, quand il ne peut pas se déduire.
     *
     * À omettre dans presque tous les cas : l'événement porte déjà
     * `serverId` ou `nodeId`, et la déduction est alors plus sûre que treize
     * appelants qui se souviennent chacun de le renseigner. À passer quand
     * l'objet vient d'être supprimé — sa ligne n'existe plus, et il n'y a plus
     * rien à lire.
     */
    scope?: WebhookScope,
  ): Promise<void> {
    try {
      const reseller = scope !== undefined ? scope.reseller : await this.perimetre(data);

      const targets = await this.db
        .select({ id: applicationWebhooks.id })
        .from(applicationWebhooks)
        /*
         * Le périmètre du rappel est celui de **sa clé**.
         *
         * Un point d'entrée déclaré sur la clé d'un revendeur recevait jusqu'ici
         * tout le trafic de la plateforme : qui commande, qui résilie, qui est
         * suspendu — y compris chez ses confrères. La jointure est donc la
         * condition d'accès, pas une commodité de lecture.
         *
         * Une clé de plateforme (`reseller_id` nul) continue de tout recevoir :
         * c'est son rôle, et c'est le comportement qu'avaient tous les rappels
         * jusqu'ici.
         */
        .innerJoin(applicationKeys, eq(applicationKeys.id, applicationWebhooks.applicationKeyId))
        .where(
          and(
            eq(applicationWebhooks.isActive, true),
            // Filtré en base plutôt qu'en mémoire : sans cela, chaque événement
            // lirait tous les points d'entrée pour n'en garder qu'un.
            arrayContains(applicationWebhooks.events, [event]),
            or(
              isNull(applicationKeys.resellerId),
              // `= null` n'apparie rien : un événement de la plateforme ne part
              // donc qu'aux clés de la plateforme, sans condition à écrire.
              sql`${applicationKeys.resellerId} = ${reseller}::uuid`,
            ),
          ),
        );

      if (targets.length === 0) return;

      /**
       * L'horodatage est celui de l'**événement**, pas de la tentative.
       *
       * Une reprise à J+1 porte donc une date d'hier, et c'est exact : le
       * receveur doit pouvoir ranger l'événement dans le temps, pas dans
       * l'ordre où le réseau a bien voulu le laisser passer.
       */
      const at = new Date().toISOString();

      await this.db.insert(applicationWebhookDeliveries).values(
        targets.map((target) => {
          const id = randomUUID();
          const payload: WebhookPayload = { id, event, at, data };
          return {
            id,
            webhookId: target.id,
            event,
            payload: payload as unknown as Record<string, unknown>,
            // Due tout de suite : le répartiteur prendra la ligne à son
            // prochain tour, dans quelques secondes.
            nextAttemptAt: at,
          };
        }),
      );
    } catch (error) {
      this.logger.error(
        `Événement « ${event} » non inscrit : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * De qui relève cet événement, lu sur ce qu'il désigne.
   *
   * Déduit du contenu plutôt que demandé à l'appelant, et c'est le point
   * important : une règle qu'il faut penser à appliquer à treize endroits n'est
   * pas une règle, c'est un rappel — on vient de le vérifier sur le périmètre
   * des clés, où quatre routes sur dix-neuf l'avaient oublié.
   *
   * Le serveur prime sur le node : un serveur vendu par un revendeur sur une
   * **part** d'une machine de la plateforme relève de lui, alors que la machine
   * n'est à personne. Lire le node d'abord le rendrait à la plateforme.
   *
   * Un objet introuvable rend `null` : l'événement part alors aux seules clés
   * de la plateforme. C'est la bonne direction pour se tromper.
   */
  private async perimetre(data: Record<string, unknown>): Promise<string | null> {
    const serverId = typeof data.serverId === "string" ? data.serverId : null;
    if (serverId !== null) {
      const [row] = await this.db
        .select({ resellerId: servers.resellerId })
        .from(servers)
        .where(eq(servers.id, serverId))
        .limit(1);
      return row?.resellerId ?? null;
    }

    const nodeId = typeof data.nodeId === "string" ? data.nodeId : null;
    if (nodeId !== null) {
      const [row] = await this.db
        .select({ ownerId: nodes.ownerId })
        .from(nodes)
        .where(eq(nodes.id, nodeId))
        .limit(1);
      return row?.ownerId ?? null;
    }

    return null;
  }
}
