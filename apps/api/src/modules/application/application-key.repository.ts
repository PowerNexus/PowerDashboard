import { apiKeyPrefix, hashToken, ipAllowed, tokensMatch } from "@gamedashboard/auth";
import { applicationKeys, type Database, users } from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Le porteur d'une clé applicative.
 *
 * Aucun `user` : c'est tout le sujet. Un système tiers n'agit au nom de
 * personne, et lui attribuer un compte porteur ferait apparaître ses actes
 * comme ceux d'un administrateur dans le journal — au moment précis où l'on
 * cherche à distinguer ce qu'un humain a décidé de ce qu'une machine a
 * appliqué.
 */
export interface ApplicationPrincipal {
  keyId: string;
  name: string;
  scopes: string[];
  /**
   * Node auquel la clé est bornée, ou `null` pour tout le parc.
   *
   * La garde ne s'en sert pas : elle ne connaît que les portées. C'est la route
   * qui compare, parce qu'elle seule sait de quel node il est question.
   */
  nodeId: string | null;
  /**
   * Revendeur auquel la clé est bornée, ou `null` pour toute la plateforme.
   *
   * La garde ne s'en sert pas davantage que du node : elle ne connaît que les
   * portées. C'est le service qui compare, parce que lui seul sait de quels
   * clients et de quels serveurs il est question.
   */
  resellerId: string | null;
  /** La clé meurt-elle à son premier usage réussi ? */
  singleUse: boolean;
}

@Injectable()
export class ApplicationKeyRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Identifie le porteur d'une clé applicative, ou `null`.
   *
   * Même procédé que pour une clé personnelle — préfixe indexé, condensat
   * comparé à durée constante — mais sur **une autre table**. Une clé
   * personnelle présentée ici n'y est pas, et une clé applicative présentée à
   * l'API client non plus : la séparation est structurelle, pas conditionnelle.
   *
   * Toutes les causes de refus rendent `null` sans les distinguer : répondre
   * « expirée » plutôt que « inconnue » confirmerait à un inconnu qu'il tient
   * une vraie clé.
   */
  async resolve(
    presented: string,
    clientIp: string | undefined,
  ): Promise<ApplicationPrincipal | null> {
    const prefix = apiKeyPrefix(presented);
    if (!prefix) return null;

    const [row] = await this.db
      .select({
        id: applicationKeys.id,
        name: applicationKeys.name,
        keyHash: applicationKeys.keyHash,
        scopes: applicationKeys.scopes,
        allowedIps: applicationKeys.allowedIps,
        expiresAt: applicationKeys.expiresAt,
        revokedAt: applicationKeys.revokedAt,
        nodeId: applicationKeys.nodeId,
        resellerId: applicationKeys.resellerId,
        singleUse: applicationKeys.singleUse,
        consumedAt: applicationKeys.consumedAt,
        resellerSuspendedAt: users.suspendedAt,
      })
      .from(applicationKeys)
      // Jointure externe : une clé de la plateforme n'a pas de revendeur, et
      // une jointure ordinaire la ferait disparaître.
      .leftJoin(users, eq(applicationKeys.resellerId, users.id))
      .where(eq(applicationKeys.prefix, prefix))
      .limit(1);

    // La comparaison a lieu même sans ligne correspondante : sinon le temps de
    // réponse distinguerait un préfixe existant d'un préfixe inventé.
    const expected = row?.keyHash ?? "";
    const matches = tokensMatch(expected, hashToken(presented));
    if (!row || !matches) return null;

    if (row.revokedAt) return null;
    // Une clé à usage unique déjà consommée vaut une clé inconnue : c'est le
    // sens même de l'usage unique, et distinguer les deux dirait à qui la
    // présente qu'il tient une vraie clé, arrivée trop tard.
    if (row.consumedAt) return null;
    /*
     * Les clés d'un revendeur suspendu se taisent avec son compte.
     *
     * Sa boutique continuerait sinon de créer et de supprimer des serveurs au
     * nom d'un compte que la plateforme vient d'arrêter. Rien n'est révoqué :
     * les clés reviennent telles quelles à la réactivation.
     */
    if (row.resellerSuspendedAt) return null;
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return null;
    if (!ipAllowed(row.allowedIps, clientIp ?? null)) return null;

    // Écrit sans attendre : l'horodatage sert à repérer une intégration
    // débranchée, pas à dater la requête.
    void this.db
      .update(applicationKeys)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(applicationKeys.id, row.id))
      .catch(() => undefined);

    return {
      keyId: row.id,
      name: row.name,
      scopes: row.scopes,
      nodeId: row.nodeId,
      resellerId: row.resellerId,
      singleUse: row.singleUse,
    };
  }

  /**
   * Marque une clé d'amorçage comme consommée.
   *
   * Appelée par la route **après** avoir rendu la configuration, jamais avant :
   * une clé brûlée par une requête qui échoue ensuite laisserait l'exploitant
   * sans rien, avec une commande qu'il ne peut plus rejouer.
   */
  async consume(keyId: string): Promise<void> {
    await this.db
      .update(applicationKeys)
      .set({ consumedAt: sql`now()`, revokedAt: sql`now()` })
      .where(eq(applicationKeys.id, keyId));
  }
}
