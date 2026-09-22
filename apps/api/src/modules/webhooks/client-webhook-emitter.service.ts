import { isClientWebhookEvent } from "@gamedashboard/contracts";
import { type Database, servers, webhookDeliveries, webhooks } from "@gamedashboard/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Dépose les rappels d'un client dans la file, quand son serveur bouge.
 *
 * **Il ne part rien d'ici.** Écrire en base et laisser le répartiteur envoyer
 * est ce qui rend le mécanisme fiable : un rappel préparé pendant qu'un
 * receveur est en panne repartira tout seul, et un redémarrage de l'API entre
 * l'événement et l'envoi ne perd rien. C'est aussi ce qui évite qu'un serveur
 * lent à répondre retienne le compte rendu du daemon qui a déclenché l'affaire.
 *
 * Le corps est **délibérément maigre** : ce qui est arrivé, à quel serveur,
 * quand. Un rappel n'est pas une API — celui qui veut l'état complet du serveur
 * interroge le panel, avec une clé dont les droits sont connus. Y verser les
 * variables de démarrage ferait fuiter les mots de passe RCON vers une adresse
 * que le client a tapée un jour dans un formulaire.
 */
@Injectable()
export class ClientWebhookEmitterService {
  private readonly logger = new Logger(ClientWebhookEmitterService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Prépare une livraison par rappel abonné à cet événement.
   *
   * Rien ne remonte à l'appelant, pas même une erreur : la notification du
   * client et le compte rendu du daemon ne doivent pas échouer parce qu'une
   * table de rappels est indisponible. L'échec est journalisé, et c'est tout ce
   * qu'on peut en faire d'utile ici.
   */
  async emit(serverId: string, event: string): Promise<void> {
    // Un événement hors catalogue ne concerne aucun abonnement possible :
    // l'écran ne propose que ceux-là. Sortir tôt évite une requête par
    // notification de facturation, qui n'a rien à voir avec un serveur.
    if (!isClientWebhookEvent(event)) return;

    try {
      const [server] = await this.db
        .select({ name: servers.name, shortId: servers.uuidShort })
        .from(servers)
        .where(eq(servers.id, serverId))
        .limit(1);

      if (!server) return;

      const abonnes = await this.db
        .select({ id: webhooks.id })
        .from(webhooks)
        .where(
          and(
            eq(webhooks.serverId, serverId),
            eq(webhooks.isActive, true),
            // `@>` : le tableau des événements contient celui-ci. Filtré en
            // base plutôt qu'en mémoire — un parc chargé a des milliers de
            // rappels, et presque aucun ne concerne cet événement.
            sql`${webhooks.events} @> ARRAY[${event}]::text[]`,
          ),
        );

      if (abonnes.length === 0) return;

      const now = new Date().toISOString();
      await this.db.insert(webhookDeliveries).values(
        abonnes.map((abonne) => ({
          webhookId: abonne.id,
          event,
          payload: {
            event,
            server: { id: serverId, name: server.name, shortId: server.shortId },
            occurredAt: now,
          },
          // Tout de suite : le répartiteur prendra la ligne à son prochain tour.
          nextAttemptAt: now,
        })),
      );
    } catch (error) {
      this.logger.warn(
        `Rappels client « ${event} » non préparés pour ${serverId} : ${
          error instanceof Error ? error.message : "cause inconnue"
        }`,
      );
    }
  }
}
