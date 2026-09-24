import { generateToken, hashToken } from "@gamedashboard/auth";
import { authTokens, type Database } from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/** Fenêtre d'émission par compte et par usage. */
const ISSUE_WINDOW_MS = 60 * 60_000;

/**
 * Jetons envoyés par courrier.
 *
 * Trois propriétés les rendent acceptables dans une boîte de réception, qui
 * n'est pas un endroit sûr : ils ne valent que pour une chose, ils expirent
 * vite, et ils cessent de valoir dès qu'ils ont servi.
 *
 * Seul le condensat est conservé, comme pour les sessions : la recherche porte
 * sur une valeur qui ne vaut rien si la table fuite.
 */

export type TokenPurpose = "password_reset" | "email_verify" | "billing_sso";

/**
 * Durée de validité.
 *
 * Une heure pour un mot de passe : assez pour aller chercher le courriel dans
 * les indésirables, assez court pour qu'un message oublié dans une boîte
 * partagée ne reste pas une clé du compte.
 *
 * Vingt-quatre heures pour une adresse : rien d'urgent, et une vérification
 * expirée oblige à recommencer une démarche qui n'ouvre aucun accès.
 *
 * Deux minutes pour une connexion venue du facturier : ce jeton-là ne voyage
 * pas dans une boîte de réception mais dans une redirection immédiate, entre le
 * clic sur « Gérer mon serveur » et l'arrivée sur le panel. Tout ce qui dépasse
 * le temps d'un aller-retour réseau est du délai offert à qui lirait le lien
 * dans un journal de serveur mandataire ou un en-tête `Referer`.
 */
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  password_reset: 60 * 60 * 1000,
  email_verify: 24 * 60 * 60 * 1000,
  billing_sso: 2 * 60 * 1000,
};

/**
 * Plafond d'émission par compte et par heure.
 *
 * Trois pour les liens qui partent **par courriel** : chaque demande expédie un
 * message, et l'adresse de la victime devient la cible.
 *
 * Trente pour la connexion depuis le facturier, où rien n'est envoyé à
 * personne : un client qui rouvre son panel dix fois dans l'après-midi est
 * ordinaire, et le refuser casserait le seul chemin d'entrée qu'il ait. Le
 * plafond y sert d'autre chose — borner les lignes écrites, et marquer une
 * limite si une clé applicative venait à servir en boucle.
 */
export const MAX_ISSUES_PER_WINDOW: Record<TokenPurpose, number> = {
  password_reset: 3,
  email_verify: 3,
  billing_sso: 30,
};

/**
 * Nature des lignes qui consignent un défi de connexion déjà servi.
 *
 * Hors de `TokenPurpose` : ces lignes ne portent aucun jeton à présenter —
 * le défi lui-même voyage scellé (`login-challenge.ts`) — et naissent
 * consommées. Elles n'entrent ni dans le plafond d'émission, ni dans les
 * révocations par usage.
 */
export const CHALLENGE_PURPOSE = "challenge";

/**
 * Condensat sous lequel un défi est consigné.
 *
 * Préfixé : un identifiant de défi et un jeton envoyé par courrier ne doivent
 * jamais pouvoir se confondre dans l'index unique qu'ils partagent.
 */
function challengeHash(jti: string): string {
  return hashToken(`challenge:${jti}`);
}

@Injectable()
export class AuthTokenRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Émet un jeton et **périme les précédents**.
   *
   * Redemander un lien doit invalider l'ancien : deux liens valables en même
   * temps, c'est deux courriels qui ouvrent le compte, et celui qu'on croyait
   * remplacé traîne encore. C'est aussi la seule défense contre quelqu'un qui
   * déclencherait des dizaines d'envois pour multiplier ses chances.
   */
  async issue(
    userId: string,
    purpose: TokenPurpose,
    ip: string | null,
  ): Promise<{ token: string; expiresAt: string } | null> {
    /*
     * Plafond d'émission par compte et par heure.
     *
     * Périmer le lien précédent empêche d'en accumuler, pas d'en faire
     * envoyer cent : chaque demande partait en courriel, et l'adresse de la
     * victime devenait la cible. Au-delà du plafond, rien n'est émis et
     * l'appelant se tait comme s'il l'avait fait.
     */
    const [recent] = await this.db
      .select({ n: count() })
      .from(authTokens)
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.purpose, purpose),
          gte(authTokens.createdAt, new Date(Date.now() - ISSUE_WINDOW_MS).toISOString()),
        ),
      );
    if ((recent?.n ?? 0) >= MAX_ISSUES_PER_WINDOW[purpose]) return null;

    await this.db
      .update(authTokens)
      .set({ consumedAt: sql`now()`, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.consumedAt),
        ),
      );

    const token = generateToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[purpose]).toISOString();

    await this.db.insert(authTokens).values({
      userId,
      purpose,
      tokenHash: hashToken(token),
      expiresAt,
      requestedIp: ip,
    });

    return { token, expiresAt };
  }

  /**
   * Éteint les jetons encore valables d'un compte, pour les usages donnés.
   *
   * Marqués consommés plutôt que supprimés, comme à l'émission d'un nouveau :
   * la trace de ce qui a été demandé reste lisible. Deux occasions : une
   * adresse qui change — un lien parti vers l'ancienne boîte ne doit plus
   * ouvrir le compte — et une suspension, qui ferme toutes les portes.
   */
  async revokePending(userId: string, purposes: readonly TokenPurpose[]): Promise<number> {
    if (purposes.length === 0) return 0;
    const rows = await this.db
      .update(authTokens)
      .set({ consumedAt: sql`now()`, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(authTokens.userId, userId),
          inArray(authTokens.purpose, [...purposes]),
          isNull(authTokens.consumedAt),
        ),
      )
      .returning({ id: authTokens.id });
    return rows.length;
  }

  /**
   * Consomme un jeton, ou rend `null`.
   *
   * La lecture et la consommation ne font qu'une écriture, et c'est
   * volontaire : lire puis marquer en deux temps laisserait, entre les deux, un
   * instant où deux requêtes simultanées obtiennent toutes deux le droit de
   * changer le mot de passe. La clause `where` porte la condition entière —
   * bon usage, non expiré, non consommé — et `returning` ne rend une ligne que
   * si elle a réellement été prise.
   *
   * `null` couvre indistinctement le jeton inconnu, expiré, déjà utilisé et
   * émis pour autre chose : l'appelant n'a pas à les distinguer, et détailler
   * renseignerait qui cherche à deviner le format.
   */
  async consume(token: string, purpose: TokenPurpose): Promise<{ userId: string } | null> {
    const [row] = await this.db
      .update(authTokens)
      .set({ consumedAt: sql`now()`, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(authTokens.tokenHash, hashToken(token)),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.consumedAt),
          sql`${authTokens.expiresAt} > now()`,
        ),
      )
      .returning({ userId: authTokens.userId });

    return row ?? null;
  }

  /**
   * Consomme un défi de connexion : `true` pour le premier qui le présente,
   * `false` pour tout autre, **sur toutes les instances de l'API**.
   *
   * La liste des défis servis vivait en mémoire d'un processus : un défi
   * servi sur une instance se rejouait sur une autre, ou après un redémarrage,
   * pendant ses cinq minutes de validité (NC-30). La consommation est une
   * insertion que l'index unique sur le condensat rend atomique — deux
   * demandes simultanées n'en gagnent qu'une, sans verrou ni relecture. La
   * ligne naît consommée et part avec la rétention des `auth_tokens`, un mois
   * après l'échéance du défi.
   *
   * Le compte doit exister (clé étrangère) : les appelants le lisent avant.
   */
  async claimChallenge(challenge: {
    jti: string;
    userId: string;
    expiresAt: number;
  }): Promise<boolean> {
    const rows = await this.db
      .insert(authTokens)
      .values({
        userId: challenge.userId,
        purpose: CHALLENGE_PURPOSE,
        tokenHash: challengeHash(challenge.jti),
        expiresAt: new Date(challenge.expiresAt).toISOString(),
        consumedAt: new Date().toISOString(),
      })
      .onConflictDoNothing({ target: authTokens.tokenHash })
      .returning({ id: authTokens.id });
    return rows.length === 1;
  }

  /**
   * Le défi a-t-il déjà servi ?
   *
   * Lecture seule, pour refuser tôt un défi rejoué — avant de vérifier un
   * code, et donc avant de brûler un code de secours ou de compter un échec.
   * Ce n'est pas elle qui garantit l'usage unique : `claimChallenge`, si.
   */
  async challengeClaimed(jti: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: authTokens.id })
      .from(authTokens)
      .where(
        and(
          eq(authTokens.tokenHash, challengeHash(jti)),
          eq(authTokens.purpose, CHALLENGE_PURPOSE),
        ),
      )
      .limit(1);
    return row !== undefined;
  }
}
