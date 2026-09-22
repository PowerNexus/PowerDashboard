import { randomBytes } from "node:crypto";
import { encryptSecret } from "@gamedashboard/auth";
import {
  CLIENT_WEBHOOK_EVENTS,
  isAcceptableWebhookUrl,
  isClientWebhookEvent,
} from "@gamedashboard/contracts";
import { type Database, servers, webhookDeliveries, webhooks } from "@gamedashboard/db";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { assertPublicDestination, PrivateDestinationError } from "../../common/public-url";

/**
 * Rappels sortants déclarés par un client, sur son serveur.
 *
 * Le secret n'est **montré qu'une fois**, à la création et à la régénération.
 * Il est chiffré et non haché, parce qu'il faut le relire à chaque envoi pour
 * calculer la signature (§5.4) — mais le relire depuis un écran n'a aucune
 * raison d'être possible : celui qui l'a perdu en demande un nouveau, et met à
 * jour son receveur. Le contraire ferait d'un accès en lecture au panel un
 * moyen de contrefaire des rappels.
 */

/** Ce que l'écran affiche. Jamais le secret. */
export interface ClientWebhook {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
}

export interface ClientWebhookDelivery {
  id: string;
  event: string;
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  deliveredAt: string | null;
  abandonedAt: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
}

/** Nombre de livraisons rendues à l'écran. Au-delà, on ne diagnostique plus, on fouille. */
const HISTORY_LIMIT = 50;

@Injectable()
export class ServerWebhooksService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(serverId: string): Promise<ClientWebhook[]> {
    return this.db
      .select({
        id: webhooks.id,
        url: webhooks.url,
        events: webhooks.events,
        isActive: webhooks.isActive,
        createdAt: webhooks.createdAt,
      })
      .from(webhooks)
      .where(eq(webhooks.serverId, serverId))
      .orderBy(desc(webhooks.createdAt));
  }

  /**
   * Historique des livraisons d'un rappel.
   *
   * **Le corps de la réponse du receveur est rendu**, et c'est voulu : sans
   * lui, « échec 400 » n'apprend rien, alors que la phrase renvoyée par le
   * receveur dit presque toujours ce qui cloche. C'est aussi l'unique raison
   * pour laquelle on stocke cet extrait.
   */
  async deliveries(serverId: string, webhookId: string): Promise<ClientWebhookDelivery[]> {
    await this.owned(serverId, webhookId);

    return this.db
      .select({
        id: webhookDeliveries.id,
        event: webhookDeliveries.event,
        attempts: webhookDeliveries.attempts,
        responseStatus: webhookDeliveries.responseStatus,
        responseBody: webhookDeliveries.responseBody,
        deliveredAt: webhookDeliveries.deliveredAt,
        abandonedAt: webhookDeliveries.abandonedAt,
        nextAttemptAt: webhookDeliveries.nextAttemptAt,
        createdAt: webhookDeliveries.createdAt,
      })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(HISTORY_LIMIT);
  }

  /** Déclare un rappel. Rend le secret, **une seule fois**. */
  async create(
    serverId: string,
    input: { url: string; events: string[] },
  ): Promise<{ webhook: ClientWebhook; secret: string }> {
    /*
     * Le propriétaire vient du **serveur**, jamais de celui qui déclare.
     *
     * Un sous-utilisateur autorisé peut poser un rappel ; il reste celui du
     * serveur. Sans quoi le retrait de son accès emporterait une intégration
     * dont le propriétaire dépend, et qu'il n'a jamais vue passer.
     */
    const [server] = await this.db
      .select({ ownerId: servers.ownerId })
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);
    if (!server) throw new NotFoundException("Serveur introuvable.");
    const ownerId = server.ownerId;

    const url = await this.acceptableUrl(input.url);
    const events = this.acceptableEvents(input.events);
    const secret = randomBytes(32).toString("base64url");

    const [row] = await this.db
      .insert(webhooks)
      .values({
        ownerId,
        serverId,
        url,
        secretEnc: encryptSecret(secret),
        events,
      })
      .returning({
        id: webhooks.id,
        url: webhooks.url,
        events: webhooks.events,
        isActive: webhooks.isActive,
        createdAt: webhooks.createdAt,
      });

    if (!row) throw new BadRequestException("Rappel non enregistré.");
    return { webhook: row, secret };
  }

  /** Change l'adresse, les événements ou l'activation. Le secret ne bouge pas. */
  async update(
    serverId: string,
    webhookId: string,
    input: { url?: string; events?: string[]; isActive?: boolean },
  ): Promise<ClientWebhook> {
    await this.owned(serverId, webhookId);
    const url = input.url === undefined ? undefined : await this.acceptableUrl(input.url);

    const [row] = await this.db
      .update(webhooks)
      .set({
        ...(url === undefined ? {} : { url }),
        ...(input.events === undefined ? {} : { events: this.acceptableEvents(input.events) }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(webhooks.id, webhookId))
      .returning({
        id: webhooks.id,
        url: webhooks.url,
        events: webhooks.events,
        isActive: webhooks.isActive,
        createdAt: webhooks.createdAt,
      });

    if (!row) throw new NotFoundException("Rappel introuvable.");
    return row;
  }

  /**
   * Remet un secret neuf.
   *
   * L'ancien cesse de valoir immédiatement : les livraisons en attente
   * partiront signées du nouveau. C'est le bon sens — un secret qu'on renouvelle
   * parce qu'il a fuité ne doit pas continuer à signer quoi que ce soit.
   */
  async rotate(serverId: string, webhookId: string): Promise<{ secret: string }> {
    await this.owned(serverId, webhookId);

    const secret = randomBytes(32).toString("base64url");
    await this.db
      .update(webhooks)
      .set({ secretEnc: encryptSecret(secret), updatedAt: new Date().toISOString() })
      .where(eq(webhooks.id, webhookId));

    return { secret };
  }

  async remove(serverId: string, webhookId: string): Promise<void> {
    await this.owned(serverId, webhookId);
    await this.db.delete(webhooks).where(eq(webhooks.id, webhookId));
  }

  /**
   * Le rappel appartient-il bien à ce serveur ?
   *
   * Vérifié à chaque geste, et pas seulement à la lecture : sans cela, un
   * identifiant de rappel pris sur un serveur suffirait à le modifier depuis
   * l'adresse d'un autre, dont on a la permission. La permission garde la
   * porte du serveur ; celle-ci garde l'objet.
   */
  private async owned(serverId: string, webhookId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: webhooks.id })
      .from(webhooks)
      .where(and(eq(webhooks.id, webhookId), eq(webhooks.serverId, serverId)))
      .limit(1);

    if (!row) throw new NotFoundException("Rappel introuvable.");
  }

  private async acceptableUrl(value: unknown): Promise<string> {
    if (typeof value !== "string" || !isAcceptableWebhookUrl(value)) {
      throw new BadRequestException(
        "Adresse invalide : une adresse « https:// » publique est exigée.",
      );
    }
    // Le filtre de forme écarte l'évident ; celui-ci résout le nom, pour
    // qu'un domaine pointant vers le réseau interne soit refusé aussi.
    try {
      await assertPublicDestination(new URL(value.trim()));
    } catch (error) {
      if (error instanceof PrivateDestinationError) throw new BadRequestException(error.message);
      throw error;
    }
    return value.trim();
  }

  /**
   * Au moins un événement, et seulement des événements connus.
   *
   * Un rappel sans événement ne partirait jamais et resterait à l'écran comme
   * s'il veillait. Un événement inconnu serait pire : la case cochée
   * laisserait croire à une couverture qui n'existe pas.
   */
  private acceptableEvents(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadRequestException("Choisissez au moins un événement.");
    }

    const events = [...new Set(value.map(String))];
    const inconnus = events.filter((event) => !isClientWebhookEvent(event));
    if (inconnus.length > 0) {
      throw new BadRequestException(`Événement inconnu : ${inconnus.join(", ")}.`);
    }

    // L'ordre du catalogue plutôt que celui de la saisie : deux rappels
    // équivalents doivent se relire pareil.
    return CLIENT_WEBHOOK_EVENTS.filter((event) => events.includes(event));
  }
}
