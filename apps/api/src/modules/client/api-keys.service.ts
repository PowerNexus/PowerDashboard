import { generateApiKey, isAllowlistEntry } from "@gamedashboard/auth";
import { SERVER_PERMISSIONS, type ServerPermission } from "@gamedashboard/contracts";
import { apiKeys, type Database } from "@gamedashboard/db";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

export interface ClientApiKey {
  id: string;
  name: string;
  /** Partie visible de la clé. Le secret n'est jamais relisible. */
  prefix: string;
  scopes: string[];
  allowedIps: string[];
  lastUsedAt: string | null;
  /**
   * Toujours posée à la création (un an au plus). `null` ne se voit que sur une
   * clé créée avant que l'échéance devienne obligatoire.
   */
  expiresAt: string | null;
  createdAt: string;
}

/** Forme d'une entrée acceptable dans la liste d'autorisation : adresse, ou bloc CIDR. */
const IP_PATTERN = /^[0-9a-fA-F:.]{3,45}(\/\d{1,3})?$/;

/**
 * Durée maximale d'une clé, et durée posée quand aucune n'est demandée : un
 * an, comme les clés applicatives.
 */
export const CLIENT_KEY_MAX_DAYS = 365;

@Injectable()
export class ApiKeysService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Clés actives d'un utilisateur.
   *
   * Les clés révoquées ne sont pas listées : leur seule utilité serait de
   * savoir qu'on les a révoquées, ce que l'écran vient de montrer. Elles restent
   * en base pour que le préfixe ne soit jamais réattribué.
   */
  async list(userId: string): Promise<ClientApiKey[]> {
    const rows = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scopes: row.scopes,
      allowedIps: row.allowedIps,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Crée une clé et rend le secret **une seule fois**.
   *
   * Seul le condensat est conservé : c'est la raison pour laquelle il n'existe
   * aucune route permettant de revoir une clé. Le contraire ferait qu'une
   * lecture de la base suffirait à piloter tous les serveurs de tous les
   * clients — exactement ce que le condensat évite.
   */
  async create(
    userId: string,
    name: string,
    scopes: string[],
    allowedIps: string[],
    /** Nombre de jours de validité ; `null` pose `CLIENT_KEY_MAX_DAYS`. */
    expiresInDays: number | null = null,
  ): Promise<{ key: ClientApiKey; plaintext: string }> {
    const unknown = scopes.filter((s) => !SERVER_PERMISSIONS.includes(s as ServerPermission));
    if (unknown.length > 0) {
      throw new BadRequestException(`Portée inconnue : ${unknown.join(", ")}.`);
    }
    if (scopes.length === 0) {
      // Une clé sans portée n'ouvre rien. La refuser évite qu'on la crée, qu'on
      // la colle dans un script, et qu'on cherche pendant une heure pourquoi
      // tout répond « interdit ».
      throw new BadRequestException("Choisissez au moins une portée.");
    }

    const invalid = allowedIps.filter((ip) => !IP_PATTERN.test(ip) || !isAllowlistEntry(ip));
    if (invalid.length > 0) {
      throw new BadRequestException(`Adresse invalide : ${invalid.join(", ")}.`);
    }

    /*
     * Une échéance, toujours.
     *
     * Sans durée demandée, la clé ne finissait jamais (audit ASVS, NC-36) :
     * collée dans un script puis oubliée, elle restait valable des années
     * après que plus personne ne savait où elle traînait. Le champ vide pose
     * désormais le maximum, comme pour les clés applicatives ; qui veut plus
     * court le dit.
     */
    const days = expiresInDays ?? CLIENT_KEY_MAX_DAYS;
    if (!Number.isInteger(days) || days < 1 || days > CLIENT_KEY_MAX_DAYS) {
      throw new BadRequestException(`La validité va de 1 à ${CLIENT_KEY_MAX_DAYS} jours.`);
    }
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const generated = generateApiKey("live");

    const [row] = await this.db
      .insert(apiKeys)
      .values({
        userId,
        name: name.trim(),
        prefix: generated.prefix,
        keyHash: generated.hash,
        scopes: [...new Set(scopes)],
        allowedIps,
        expiresAt,
      })
      .returning();

    if (!row) throw new BadRequestException("Clé non enregistrée.");

    return {
      plaintext: generated.plaintext,
      key: {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        scopes: row.scopes,
        allowedIps: row.allowedIps,
        lastUsedAt: null,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      },
    };
  }

  /**
   * Révoque.
   *
   * La ligne est horodatée, pas supprimée : le préfixe reste ainsi réservé, et
   * une clé qui refait surface dans un dépôt public continue de correspondre à
   * une ligne révoquée plutôt qu'à rien — ce qui permettra plus tard de dire
   * *quelle* clé a fuité.
   */
  async revoke(userId: string, keyId: string): Promise<void> {
    const [row] = await this.db
      .update(apiKeys)
      .set({ revokedAt: sql`now()`, updatedAt: new Date().toISOString() })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id });

    if (!row) throw new NotFoundException("Clé introuvable.");
  }
}
