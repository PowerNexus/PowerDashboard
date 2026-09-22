import { randomBytes } from "node:crypto";
import { encryptSecret } from "@gamedashboard/auth";
import { isWebhookEvent } from "@gamedashboard/contracts";
import {
  applicationKeys,
  applicationWebhookDeliveries,
  applicationWebhooks,
  type Database,
} from "@gamedashboard/db";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { assertPublicDestination, PrivateDestinationError } from "../../common/public-url";

export interface WebhookSummary {
  id: string;
  applicationKeyId: string;
  applicationKeyName: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
}

export interface DeliverySummary {
  id: string;
  webhookId: string;
  event: string;
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  abandonedAt: string | null;
  createdAt: string;
}

/** 256 bits : un secret de signature n'a pas à être mémorisable. */
const SECRET_BYTES = 32;

/**
 * Déclaration des points d'entrée de rappel.
 *
 * Le secret est **chiffré**, pas haché, parce qu'il faut le relire à chaque
 * envoi pour calculer le HMAC. Il n'est malgré tout montré qu'une fois : le
 * réafficher sur demande ferait d'un écran d'administration compromis une
 * source de signatures valides, alors que le regénérer ne coûte qu'une
 * reconfiguration chez le tiers.
 */
@Injectable()
export class WebhookRegistryService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Les points d'entrée déclarés.
   *
   * `resellerId` ne vient jamais de la requête : il vient de la session ou de
   * la clé. Un revendeur ne voit que les rappels posés sur **ses** clés —
   * c'est-à-dire, par construction, ceux qui ne reçoivent que son trafic.
   */
  async all(resellerId: string | null = null): Promise<WebhookSummary[]> {
    return this.db
      .select({
        id: applicationWebhooks.id,
        applicationKeyId: applicationWebhooks.applicationKeyId,
        applicationKeyName: applicationKeys.name,
        url: applicationWebhooks.url,
        events: applicationWebhooks.events,
        isActive: applicationWebhooks.isActive,
        lastSuccessAt: applicationWebhooks.lastSuccessAt,
        lastFailureAt: applicationWebhooks.lastFailureAt,
        createdAt: applicationWebhooks.createdAt,
      })
      .from(applicationWebhooks)
      .innerJoin(applicationKeys, eq(applicationWebhooks.applicationKeyId, applicationKeys.id))
      .where(resellerId === null ? undefined : eq(applicationKeys.resellerId, resellerId))
      .orderBy(desc(applicationWebhooks.createdAt));
  }

  /**
   * Dernières livraisons : l'écran de diagnostic.
   *
   * Bornées au périmètre elles aussi. Le contenu d'une livraison est
   * l'événement lui-même — qui a commandé, quel serveur, chez qui — et la liste
   * dirait donc à un revendeur ce qui se passe chez ses confrères, alors même
   * que le rappel correspondant ne lui est jamais parti.
   */
  async deliveries(limit = 50, resellerId: string | null = null): Promise<DeliverySummary[]> {
    return this.db
      .select({
        id: applicationWebhookDeliveries.id,
        webhookId: applicationWebhookDeliveries.webhookId,
        event: applicationWebhookDeliveries.event,
        attempts: applicationWebhookDeliveries.attempts,
        responseStatus: applicationWebhookDeliveries.responseStatus,
        responseBody: applicationWebhookDeliveries.responseBody,
        nextAttemptAt: applicationWebhookDeliveries.nextAttemptAt,
        deliveredAt: applicationWebhookDeliveries.deliveredAt,
        abandonedAt: applicationWebhookDeliveries.abandonedAt,
        createdAt: applicationWebhookDeliveries.createdAt,
      })
      .from(applicationWebhookDeliveries)
      .where(
        resellerId === null
          ? undefined
          : sql`exists (
              select 1 from ${applicationWebhooks} w
              join ${applicationKeys} k on k.id = w.application_key_id
              where w.id = ${applicationWebhookDeliveries.webhookId}
                and k.reseller_id = ${resellerId}
            )`,
      )
      .orderBy(desc(applicationWebhookDeliveries.createdAt))
      .limit(limit);
  }

  /**
   * La condition « ce point d'entrée est à lui », à poser **dans** l'écriture.
   *
   * Posée dans le `where` de l'UPDATE ou du DELETE, et non dans une lecture
   * préalable : entre une vérification et une écriture séparées, il reste un
   * instant où la réponse peut changer. Ici, la ligne ne bouge que si elle
   * relève bien de lui, et le nombre de lignes touchées le dit.
   */
  private sien(resellerId: string | null) {
    if (resellerId === null) return undefined;
    return sql`exists (
      select 1 from ${applicationKeys} k
      where k.id = ${applicationWebhooks.applicationKeyId}
        and k.reseller_id = ${resellerId}
    )`;
  }

  /**
   * Déclare un point d'entrée et rend son secret, une seule fois.
   *
   * L'URL doit être en `https` hors développement : un rappel en clair expose
   * l'identité des clients et leurs serveurs à qui écoute le réseau, et la
   * signature n'y change rien — elle prouve l'origine, elle ne cache pas le
   * contenu.
   */
  async create(
    input: {
      applicationKeyId: string;
      url: string;
      events: string[];
    },
    resellerId: string | null = null,
  ): Promise<{ webhook: { id: string }; secret: string }> {
    const url = input.url.trim();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException("URL invalide.");
    }

    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      throw new BadRequestException(
        "Le point d'entrée doit être en https. La signature prouve l'origine, elle ne chiffre pas le contenu.",
      );
    }

    // Hors développement, la destination doit être publique : le panel ne
    // sonde pas son propre réseau pour le compte d'un tiers.
    if (parsed.hostname !== "localhost") {
      try {
        await assertPublicDestination(parsed);
      } catch (error) {
        if (error instanceof PrivateDestinationError) throw new BadRequestException(error.message);
        throw error;
      }
    }

    const unknown = input.events.filter((event) => !isWebhookEvent(event));
    if (unknown.length > 0) {
      throw new BadRequestException(`Événement inconnu : ${unknown.join(", ")}.`);
    }
    if (input.events.length === 0) {
      throw new BadRequestException("Choisissez au moins un événement, sinon rien ne partira.");
    }

    /*
     * La clé doit être la sienne, et le périmètre entre dans la recherche.
     *
     * Le message ne distingue pas « cette clé n'existe pas » de « cette clé
     * n'est pas à vous » : la distinction n'intéresse que celui qui cherche à
     * énumérer les clés des autres revendeurs.
     */
    const [key] = await this.db
      .select({ id: applicationKeys.id, revokedAt: applicationKeys.revokedAt })
      .from(applicationKeys)
      .where(
        resellerId === null
          ? eq(applicationKeys.id, input.applicationKeyId)
          : and(
              eq(applicationKeys.id, input.applicationKeyId),
              eq(applicationKeys.resellerId, resellerId),
            ),
      )
      .limit(1);

    if (!key) throw new BadRequestException("Clé applicative inconnue.");
    if (key.revokedAt) {
      // Un rappel rattaché à une clé coupée n'aurait aucun destinataire actif :
      // le système visé ne peut de toute façon plus rien faire de l'information.
      throw new BadRequestException("Cette clé applicative est révoquée.");
    }

    const secret = randomBytes(SECRET_BYTES).toString("base64url");

    const [created] = await this.db
      .insert(applicationWebhooks)
      .values({
        applicationKeyId: input.applicationKeyId,
        url,
        secretEnc: encryptSecret(secret),
        events: [...new Set(input.events)],
      })
      .returning({ id: applicationWebhooks.id });

    if (!created) throw new BadRequestException("Le point d'entrée n'a pas pu être créé.");
    return { webhook: created, secret };
  }

  /**
   * Regénère le secret de signature.
   *
   * L'ancien cesse immédiatement d'être valable, sans fenêtre de recouvrement.
   * La conséquence est à connaître avant de cliquer : un tiers qui refuse une
   * signature répond en général 401 ou 403, et un 4xx n'est pas repris — les
   * rappels envoyés entre la rotation et la reconfiguration seront donc perdus,
   * pas différés. On regénère quand on est prêt à coller la nouvelle valeur en
   * face, pas avant.
   */
  async rotateSecret(
    webhookId: string,
    resellerId: string | null = null,
  ): Promise<{ secret: string }> {
    const secret = randomBytes(SECRET_BYTES).toString("base64url");

    const [updated] = await this.db
      .update(applicationWebhooks)
      .set({ secretEnc: encryptSecret(secret), updatedAt: new Date().toISOString() })
      .where(and(eq(applicationWebhooks.id, webhookId), this.sien(resellerId)))
      .returning({ id: applicationWebhooks.id });

    if (!updated) throw new NotFoundException("Point d'entrée introuvable.");
    return { secret };
  }

  /**
   * Active ou suspend un point d'entrée.
   *
   * Suspendre ne vide pas la file : les livraisons en attente restent, et le
   * répartiteur les ignore tant que c'est fermé. Réactiver reprend donc là où
   * l'on s'était arrêté, ce qui est le comportement attendu d'une coupure
   * volontaire le temps d'une maintenance chez le tiers.
   */
  async setActive(
    webhookId: string,
    active: boolean,
    resellerId: string | null = null,
  ): Promise<void> {
    const [updated] = await this.db
      .update(applicationWebhooks)
      .set({ isActive: active, updatedAt: new Date().toISOString() })
      .where(and(eq(applicationWebhooks.id, webhookId), this.sien(resellerId)))
      .returning({ id: applicationWebhooks.id });

    if (!updated) throw new NotFoundException("Point d'entrée introuvable.");
  }

  async remove(webhookId: string, resellerId: string | null = null): Promise<void> {
    const [deleted] = await this.db
      .delete(applicationWebhooks)
      .where(and(eq(applicationWebhooks.id, webhookId), this.sien(resellerId)))
      .returning({ id: applicationWebhooks.id });

    if (!deleted) throw new NotFoundException("Point d'entrée introuvable.");
  }
}
