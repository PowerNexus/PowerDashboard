import {
  activityLogs,
  type Database,
  loginAttempts,
  notifications,
  sessions,
  users,
} from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/** Ce qu'une alerte a besoin de savoir de son destinataire. */
export interface AlertRecipient {
  id: string;
  email: string;
  locale: string;
  timezone: string;
  /** L'alerte ne part par courriel qu'à une adresse confirmée. */
  emailVerifiedAt: string | null;
}

/** Une session passée, telle que l'empreinte en a besoin. */
export interface PastSignIn {
  ip: string | null;
  userAgent: string | null;
}

/**
 * Au-delà, l'historique n'apprend plus rien.
 *
 * Cinq cents sessions, c'est des années de connexions quotidiennes ; la
 * rétention en retire de toute façon les sessions fermées depuis trois mois.
 * La borne protège d'un compte piloté par un script qui en ouvrirait des
 * milliers.
 */
const HISTORY_LIMIT = 500;

/**
 * Lectures des alertes de sécurité (§5.1), sur les tables existantes.
 *
 * Aucune table dédiée : les tentatives sont déjà dans `login_attempts`,
 * l'historique des appareils dans `sessions` (conservées après fermeture), et
 * la trace « déjà prévenu » dans `notifications`. En ajouter une aurait fait
 * une seconde vérité à tenir d'accord avec les trois autres.
 */
@Injectable()
export class SecurityAlertRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async recipient(userId: string): Promise<AlertRecipient | null> {
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        locale: users.locale,
        timezone: users.timezone,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Échecs **consécutifs** d'un compte depuis `since`.
   *
   * Seuls comptent ceux qui suivent la dernière réussite : quelqu'un qui se
   * trompe trois fois le matin, entre, puis trois fois l'après-midi n'est pas
   * attaqué. Le compteur du verrou (`countRecentFailures`) est distinct et
   * n'est pas touché : ce qui décide d'un blocage n'a pas à suivre ce qui
   * décide d'un courriel.
   */
  async consecutiveFailures(email: string, since: Date): Promise<number> {
    const from = since.toISOString();
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(loginAttempts)
      .where(
        and(
          sql`lower(${loginAttempts.email}) = lower(${email})`,
          eq(loginAttempts.success, false),
          gte(loginAttempts.at, from),
          sql`${loginAttempts.at} > coalesce((
            select max(ok.at) from login_attempts ok
            where lower(ok.email) = lower(${email}) and ok.success and ok.at >= ${from}
          ), '-infinity'::timestamptz)`,
        ),
      );
    return row?.total ?? 0;
  }

  /**
   * Tous les échecs d'un compte depuis `since`, réussites intercalées ou non.
   *
   * C'est le compteur du verrou (`UserRepository.countRecentFailures`), relu
   * ici pour savoir si l'échec qu'on consigne vient de l'enclencher.
   */
  async failuresSince(email: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(loginAttempts)
      .where(
        and(
          sql`lower(${loginAttempts.email}) = lower(${email})`,
          eq(loginAttempts.success, false),
          gte(loginAttempts.at, since.toISOString()),
        ),
      );
    return row?.total ?? 0;
  }

  /** Une alerte de ce type est-elle déjà partie depuis `since` ? */
  async alertedSince(userId: string, type: string, since: Date): Promise<boolean> {
    const [row] = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, type),
          gte(notifications.createdAt, since.toISOString()),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  /**
   * Sessions ouvertes **avant** celle qu'on examine, fermées comprises.
   *
   * La session en cours est écartée par son condensat : elle vient d'être
   * écrite, et la compter reviendrait à juger chaque appareil déjà connu. Les
   * prises en main sont écartées aussi — leur adresse et leur agent sont ceux
   * du membre du personnel, pas ceux du titulaire.
   */
  async priorSignIns(userId: string, currentTokenHash: string): Promise<PastSignIn[]> {
    return await this.db
      .select({ ip: sessions.ip, userAgent: sessions.userAgent })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          ne(sessions.tokenHash, currentTokenHash),
          isNull(sessions.impersonatorId),
        ),
      )
      .orderBy(desc(sessions.createdAt))
      .limit(HISTORY_LIMIT);
  }

  /**
   * Pays déjà vus pour ce compte.
   *
   * Lus dans le journal des connexions (`account.login`), faute de colonne sur
   * les sessions : la base n'a pas à changer pour une information qui n'existe
   * que derrière un frontal Cloudflare.
   */
  async knownCountries(userId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ country: sql<string>`${activityLogs.properties}->>'country'` })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.actorId, userId),
          eq(activityLogs.event, "account.login"),
          sql`${activityLogs.properties} ? 'country'`,
        ),
      );
    return rows.map((row) => row.country).filter((country) => typeof country === "string");
  }
}
