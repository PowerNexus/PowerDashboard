import { ATTEMPT_WINDOW_MS } from "@gamedashboard/auth";
import { type Database, loginAttempts, users } from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

export interface AuthenticatableUser {
  id: string;
  email: string;
  passwordHash: string | null;
}

@Injectable()
export class UserRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Recherche insensible à la casse : « Paul@ex.fr » et « paul@ex.fr »
   * désignent la même boîte, et refuser la connexion sur une majuscule serait
   * incompréhensible pour l'utilisateur.
   */
  async findByEmail(email: string): Promise<AuthenticatableUser | null> {
    const [row] = await this.db
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);

    return row ?? null;
  }

  /**
   * Recherche par identifiant, avec le condensat.
   *
   * Distincte de ce que pose `SessionGuard` sur la requête, et il faut qu'elle
   * le reste : le profil attaché à la requête ne porte délibérément pas le
   * condensat du mot de passe, pour qu'un contrôleur ne puisse pas le renvoyer
   * par inadvertance. Le relire ici est un acte explicite.
   */
  async findById(id: string): Promise<
    | (AuthenticatableUser & {
        nameFirst: string;
        nameLast: string;
        /** Nul tant que l'adresse n'a pas été confirmée par un clic. */
        emailVerifiedAt: string | null;
      })
    | null
  > {
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        nameFirst: users.nameFirst,
        nameLast: users.nameLast,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return row ?? null;
  }

  /**
   * Marque l'adresse comme vérifiée.
   *
   * La condition `is null` fait partie de la requête : sans elle, un lien rejoué
   * réécrirait la date, et l'on perdrait le moment réel où l'adresse a été
   * confirmée. La ligne est relue ensuite pour que l'appelant puisse journaliser
   * l'adresse concernée — ou constater que le compte a disparu entre l'envoi du
   * courrier et le clic.
   */
  async markEmailVerified(id: string): Promise<{ id: string; email: string } | null> {
    await this.db
      .update(users)
      .set({ emailVerifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(and(eq(users.id, id), isNull(users.emailVerifiedAt)));

    const [row] = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return row ?? null;
  }

  /**
   * Crée un compte depuis l'inscription publique.
   *
   * Le rôle est **imposé** à « user » et ne vient jamais du corps de la requête :
   * un champ recopié tel quel permettrait de se déclarer administrateur à
   * l'inscription. Les comptes de personnel se créent depuis l'administration.
   *
   * L'adresse est non vérifiée : la vérification n'ouvre aucun droit, elle
   * atteste seulement que la boîte est lue.
   */
  /**
   * Compte créé depuis une invitation nominative, **adresse déjà vérifiée**.
   *
   * Le lien d'invitation a prouvé la possession de la boîte : redemander une
   * confirmation ferait recommencer une démarche déjà accomplie, et laisserait
   * entre-temps un compte « non vérifié » que rien ne distingue d'un compte
   * douteux.
   *
   * Méthode distincte de `register` plutôt qu'un drapeau : « créer un compte
   * vérifié » est une autorité, pas une option, et un paramètre booléen finit
   * par être passé depuis un endroit qui n'y avait pas droit.
   */
  async registerVerified(input: {
    email: string;
    nameFirst: string;
    nameLast: string;
    passwordHash: string;
  }): Promise<{ id: string; email: string }> {
    const now = new Date().toISOString();
    const [row] = await this.db
      .insert(users)
      .values({
        email: input.email,
        passwordHash: input.passwordHash,
        nameFirst: input.nameFirst,
        nameLast: input.nameLast,
        role: "user",
        emailVerifiedAt: now,
      })
      .returning({ id: users.id, email: users.email });

    if (!row) throw new Error("Compte non créé.");
    return row;
  }

  async register(input: {
    email: string;
    nameFirst: string;
    nameLast: string;
    passwordHash: string;
  }): Promise<{ id: string; email: string }> {
    const [row] = await this.db
      .insert(users)
      .values({
        email: input.email,
        passwordHash: input.passwordHash,
        nameFirst: input.nameFirst,
        nameLast: input.nameLast,
        role: "user",
        emailVerifiedAt: null,
      })
      .returning({ id: users.id, email: users.email });

    if (!row) throw new Error("Compte non créé.");
    return row;
  }

  /** Remplace le condensat du mot de passe. */
  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id));
  }

  /** Journalise la tentative, réussie ou non : c'est ce qui alimente l'alerte (§5.1). */
  async recordAttempt(email: string, ip: string | null, success: boolean): Promise<void> {
    await this.db.insert(loginAttempts).values({
      email,
      // La colonne est `not null` : une IP absente derrière un proxy mal
      // configuré ne doit pas faire échouer la connexion elle-même.
      ip: ip ?? "0.0.0.0",
      success,
      at: new Date().toISOString(),
    });
  }

  /**
   * Note qu'une session vient de s'ouvrir pour ce compte.
   *
   * L'échec est avalé : cette écriture **décrit** la connexion, elle ne la
   * conduit pas. Refuser d'ouvrir une session parce que l'horodatage n'a pas pu
   * être posé reviendrait à casser le service pour préserver son journal.
   */
  async noteLogin(userId: string): Promise<void> {
    try {
      await this.db
        .update(users)
        .set({ lastLoginAt: new Date().toISOString() })
        .where(eq(users.id, userId));
    } catch {
      // Sans conséquence : la prochaine connexion réessaiera.
    }
  }

  /**
   * Échecs récents sur les deux axes de `throttleDecision` : le compte et
   * l'adresse. Une IP absente (proxy mal configuré) ne compte pas : elle est
   * enregistrée sous `0.0.0.0`, et compter cette valeur verrouillerait tout le
   * monde sur un seul compteur.
   */
  async recentFailures(email: string, ip: string | null): Promise<{ account: number; ip: number }> {
    const [account, byIp] = await Promise.all([
      this.countRecentFailures(email),
      ip === null ? Promise.resolve(0) : this.countRecentFailuresByIp(ip),
    ]);
    return { account, ip: byIp };
  }

  /** Échecs récents depuis cette adresse, tous comptes confondus. */
  async countRecentFailuresByIp(ip: string): Promise<number> {
    const since = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(loginAttempts)
      .where(
        and(
          eq(loginAttempts.ip, ip),
          eq(loginAttempts.success, false),
          gte(loginAttempts.at, since),
        ),
      );
    return row?.total ?? 0;
  }

  /** Échecs récents pour ce compte, dans la fenêtre glissante. */
  async countRecentFailures(email: string): Promise<number> {
    const since = new Date(Date.now() - ATTEMPT_WINDOW_MS).toISOString();
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(loginAttempts)
      .where(
        and(
          sql`lower(${loginAttempts.email}) = lower(${email})`,
          eq(loginAttempts.success, false),
          gte(loginAttempts.at, since),
        ),
      );
    return row?.total ?? 0;
  }
}
