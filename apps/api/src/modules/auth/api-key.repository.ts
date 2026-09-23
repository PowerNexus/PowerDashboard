import { apiKeyPrefix, hashToken, ipAllowed, tokensMatch } from "@gamedashboard/auth";
import { apiKeys, type Database, users } from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import type { SessionUser } from "./session.repository";

export interface ApiKeyPrincipal {
  user: SessionUser;
  keyId: string;
  /** Portées de la clé. Elles **bornent** les droits de son propriétaire. */
  scopes: string[];
}

@Injectable()
export class ApiKeyRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Identifie le porteur d'une clé, ou `null`.
   *
   * La ligne est retrouvée par le préfixe en clair, indexé, puis le condensat
   * est comparé à durée constante. Chercher par condensat fonctionnerait aussi,
   * mais le préfixe rend la clé reconnaissable par les détecteurs de secrets
   * des forges — et la plupart des clés fuitent par un dépôt public, pas par
   * une attaque (§5.1).
   *
   * Toutes les causes de refus rendent `null` sans les distinguer : dire
   * « cette clé est expirée » plutôt que « clé inconnue » confirmerait à un
   * inconnu qu'il tient une vraie clé.
   */
  async resolve(presented: string, clientIp: string | undefined): Promise<ApiKeyPrincipal | null> {
    const prefix = apiKeyPrefix(presented);
    if (!prefix) return null;

    const [row] = await this.db
      .select({
        id: apiKeys.id,
        keyHash: apiKeys.keyHash,
        scopes: apiKeys.scopes,
        allowedIps: apiKeys.allowedIps,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
        userId: users.id,
        email: users.email,
        nameFirst: users.nameFirst,
        nameLast: users.nameLast,
        role: users.role,
        locale: users.locale,
        timezone: users.timezone,
        avatarUrl: users.avatarUrl,
        emailVerifiedAt: users.emailVerifiedAt,
        suspendedAt: users.suspendedAt,
      })
      .from(apiKeys)
      .innerJoin(users, eq(apiKeys.userId, users.id))
      .where(eq(apiKeys.prefix, prefix))
      .limit(1);

    // La comparaison a lieu même quand aucune ligne ne correspond : sans cela,
    // le temps de réponse distinguerait un préfixe existant d'un préfixe
    // inventé, et permettrait d'énumérer les clés valides.
    const expected = row?.keyHash ?? "";
    const matches = tokensMatch(expected, hashToken(presented));
    if (!row || !matches) return null;

    if (row.revokedAt) return null;
    // Compte suspendu : ses clés se taisent avec lui, sans qu'il faille les
    // révoquer une à une — et elles reviennent intactes à la réactivation.
    if (row.suspendedAt !== null) return null;
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return null;

    /**
     * Restriction d'adresse.
     *
     * Une liste vide vaut « toutes les adresses » : c'est le défaut, et le
     * contraire rendrait toute clé inutilisable dès sa création.
     */
    if (!ipAllowed(row.allowedIps, clientIp ?? null)) return null;

    // Écrit sans attendre : l'horodatage d'usage sert à repérer les clés
    // oubliées, et faire patienter la requête pour cela n'aurait pas de sens.
    void this.db
      .update(apiKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(apiKeys.id, row.id))
      .catch(() => undefined);

    return {
      keyId: row.id,
      scopes: row.scopes,
      user: {
        id: row.userId,
        email: row.email,
        nameFirst: row.nameFirst,
        nameLast: row.nameLast,
        role: row.role,
        locale: row.locale,
        timezone: row.timezone,
        avatarUrl: row.avatarUrl,
        emailVerifiedAt: row.emailVerifiedAt,
        // Ce n'est pas une session de navigateur : le dire évite qu'un écran
        // affiche « connecté par mot de passe » à une requête de script.
        authMethod: "api-key",
        // Une clé d'API n'est jamais une prise en main : elle appartient au
        // compte et agit en son nom propre, sans emprunteur derrière.
        impersonator: null,
      },
    };
  }
}
