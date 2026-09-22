import { generateToken, hashToken, tokenValidity } from "@gamedashboard/auth";
import { type Database, sessions, users } from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DATABASE } from "../../common/database.provider";

export interface SessionUser {
  id: string;
  email: string;
  nameFirst: string;
  nameLast: string;
  role: string;
  locale: string;
  timezone: string;
  avatarUrl: string | null;
  /** Nul tant que l'adresse n'a pas été confirmée par un clic. */
  emailVerifiedAt: string | null;
  /**
   * Chemin d'entrée de **cette** session : `password`, `passkey`, `sso`, ou le
   * nom d'un fournisseur OAuth.
   *
   * Affiché au compte pour qu'il sache par où il est entré : quelqu'un venu par
   * Google chercherait autrement un mot de passe qu'il n'a peut-être jamais
   * défini.
   */
  authMethod: string;
  /**
   * Membre du personnel qui regarde ce compte, ou `null` dans le cas courant.
   *
   * Sa présence est ce qui distingue une prise en main d'une vraie session : le
   * reste — identité, rôle, droits — est **celui du client**, précisément pour
   * que rien d'autre n'ait à s'en soucier.
   */
  impersonator: { id: string; email: string } | null;
}

/**
 * Seconde vue de `users`, pour joindre le membre du personnel qui a ouvert une
 * session par emprunt sans se confondre avec le titulaire du compte.
 */
const staff = alias(users, "impersonator");

/** Durée d'une session inactive. Au-delà, il faut se reconnecter. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Granularité de `last_seen_at`.
 *
 * Chaque requête servie pourrait rafraîchir la colonne, mais cela ferait une
 * écriture par requête sur une table lue à chaque requête — un coût permanent
 * pour une précision que personne ne regarde. En dessous de ce seuil, la
 * valeur en base est jugée assez fraîche et rien n'est écrit.
 */
export const LAST_SEEN_PRECISION_MS = 5 * 60 * 1000;

/**
 * Faut-il réécrire `last_seen_at` ?
 *
 * Extrait du dépôt pour être vérifiable sans base : c'est la seule décision de
 * la fonction qui l'appelle, et elle se prend sur les deux cas qu'on ne veut
 * pas voir régresser — la session jamais vue, qu'il faut inscrire, et l'horloge
 * qui recule, où une soustraction négative ne doit pas empêcher l'écriture à
 * tout jamais.
 */
export function shouldRecordLastSeen(lastSeenAt: string | null, now: number): boolean {
  if (!lastSeenAt) return true;
  const previous = Date.parse(lastSeenAt);
  // Valeur illisible en base : on réécrit plutôt que de propager un NaN, dont
  // toute comparaison est fausse et qui gèlerait la colonne définitivement.
  if (Number.isNaN(previous)) return true;
  // Une date future — horloge corrigée, réplique en avance — ne doit pas
  // bloquer l'écriture jusqu'à ce que le présent la rattrape.
  if (previous > now) return true;
  return now - previous >= LAST_SEEN_PRECISION_MS;
}

/**
 * Session telle que son propriétaire la voit.
 *
 * Le condensat n'en fait pas partie, et les champs sont énumérés un par un
 * plutôt que retirés par omission : ajouter demain une colonne sensible à la
 * table ne doit pas l'expédier automatiquement au navigateur.
 */
export interface SessionSummary {
  id: string;
  ip: string | null;
  userAgent: string | null;
  deviceLabel: string | null;
  /** Par quel moyen cette session a été ouverte. */
  authMethod: string;
  createdAt: string;
  /** `null` tant qu'aucune requête n'a été servie depuis l'ajout de la colonne. */
  lastSeenAt: string | null;
  expiresAt: string;
  isCurrent: boolean;
}

@Injectable()
export class SessionRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Crée une session et renvoie le jeton en clair.
   *
   * Le jeton n'est stocké que sous forme de condensat : une fuite de la table
   * ne permet donc pas d'ouvrir les sessions en cours. C'est le même
   * raisonnement que pour les mots de passe, avec une différence — le jeton
   * étant tiré au hasard sur 256 bits, SHA-256 sans étirement suffit.
   */
  async create(
    userId: string,
    context: {
      ip?: string | null;
      userAgent?: string | null;
      /**
       * Par quel chemin on entre. Consigné ici parce que c'est le seul endroit
       * qui le sache : plus tard, plus personne ne pourra le dire.
       */
      authMethod?: string;
      /** Personnel qui ouvre cette session pour le compte du client. */
      impersonatorId?: string | null;
      /** Durée de vie, quand elle diffère du défaut — une prise en main est brève. */
      ttlMs?: number;
    },
  ): Promise<string> {
    const token = generateToken();
    const now = new Date().toISOString();
    await this.db.insert(sessions).values({
      userId,
      impersonatorId: context.impersonatorId ?? null,
      tokenHash: hashToken(token),
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
      authMethod: context.authMethod ?? "password",
      // Une session qui vient d'être ouverte a bien été vue à l'instant :
      // laisser la colonne vide ferait afficher « jamais » sur la ligne de
      // l'appareil depuis lequel on est en train de lire la page.
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + (context.ttlMs ?? SESSION_TTL_MS)).toISOString(),
    });
    return token;
  }

  /**
   * Retrouve l'utilisateur d'une session valide.
   *
   * La recherche se fait sur le condensat, jamais sur le jeton : l'index porte
   * donc sur une valeur qui ne vaut rien si la base fuite.
   */
  async resolve(token: string): Promise<SessionUser | null> {
    const tokenHash = hashToken(token);
    const [row] = await this.db
      .select({
        expiresAt: sessions.expiresAt,
        revokedAt: sessions.revokedAt,
        lastSeenAt: sessions.lastSeenAt,
        id: users.id,
        email: users.email,
        nameFirst: users.nameFirst,
        nameLast: users.nameLast,
        role: users.role,
        locale: users.locale,
        timezone: users.timezone,
        emailVerifiedAt: users.emailVerifiedAt,
        avatarUrl: users.avatarUrl,
        authMethod: sessions.authMethod,
        impersonatorId: sessions.impersonatorId,
        // Jointure à gauche sur une seconde vue de `users` : la ligne existe
        // dans l'immense majorité des cas sans emprunteur, et une jointure
        // ordinaire ferait alors disparaître la session elle-même.
        impersonatorEmail: staff.email,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .leftJoin(staff, eq(sessions.impersonatorId, staff.id))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);

    if (!row) return null;
    // Expirée ou révoquée : la ligne reste en base pour que l'utilisateur
    // puisse constater la fermeture depuis /account/security.
    if (tokenValidity(row) !== "valid") return null;

    await this.touch(tokenHash, row.lastSeenAt);

    const {
      expiresAt: _e,
      revokedAt: _r,
      lastSeenAt: _l,
      impersonatorId,
      impersonatorEmail,
      ...user
    } = row;

    return {
      ...user,
      // Les deux ou rien : un identifiant sans adresse viendrait d'un compte de
      // personnel supprimé depuis, et l'écran ne saurait nommer personne.
      impersonator:
        impersonatorId && impersonatorEmail
          ? { id: impersonatorId, email: impersonatorEmail }
          : null,
    };
  }

  /**
   * Rafraîchit `last_seen_at`, au plus une fois par tranche de précision.
   *
   * L'échec est avalé : cette écriture décrit la requête, elle ne la conduit
   * pas. Faire échouer un affichage de page parce que la trace n'a pas pu être
   * mise à jour reviendrait à casser le service pour préserver son journal.
   */
  private async touch(tokenHash: string, lastSeenAt: string | null): Promise<void> {
    const now = Date.now();
    if (!shouldRecordLastSeen(lastSeenAt, now)) return;
    try {
      await this.db
        .update(sessions)
        .set({ lastSeenAt: new Date(now).toISOString() })
        .where(eq(sessions.tokenHash, tokenHash));
    } catch {
      // Sans conséquence : la prochaine requête réessaiera.
    }
  }

  /**
   * Sessions encore ouvertes d'un compte, la plus récemment vue en tête.
   *
   * Les sessions révoquées et expirées sont écartées : la page demande « où
   * suis-je connecté », et une liste qui mélange les deux ferait révoquer dans
   * le vide des lignes déjà fermées. La trace, elle, reste en base.
   */
  async listForUser(userId: string, currentToken?: string | null): Promise<SessionSummary[]> {
    const currentHash = currentToken ? hashToken(currentToken) : null;
    const rows = await this.db
      .select({
        id: sessions.id,
        tokenHash: sessions.tokenHash,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
        deviceLabel: sessions.deviceLabel,
        authMethod: sessions.authMethod,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          sql`${sessions.expiresAt} > now()`,
        ),
      )
      // `lastSeenAt` peut manquer sur les sessions ouvertes avant l'ajout de
      // la colonne ; le repli sur la date de création les place à leur place
      // plutôt qu'en bloc à la fin.
      .orderBy(desc(sql`coalesce(${sessions.lastSeenAt}, ${sessions.createdAt})`));

    return rows.map(({ tokenHash, ...row }) => ({
      ...row,
      isCurrent: currentHash !== null && tokenHash === currentHash,
    }));
  }

  /** Révoque une session sans la supprimer : la trace doit rester visible. */
  async revoke(token: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(and(eq(sessions.tokenHash, hashToken(token))));
  }

  /**
   * Révoque une session désignée par son identifiant.
   *
   * La condition porte aussi sur `userId`, et ce n'est pas une ceinture de
   * sécurité : sans elle, un identifiant de session deviendrait une commande
   * de déconnexion valable contre n'importe quel compte. `revoked` vaut
   * `false` quand rien n'a été touché — identifiant inconnu, session d'un
   * autre, ou déjà fermée — sans dire laquelle de ces raisons, ce qui en
   * ferait un moyen de tester l'existence des sessions d'autrui.
   *
   * `wasCurrent` est calculé ici, dans la même requête : le condensat ne sort
   * pas du dépôt, et l'appelant a pourtant besoin de savoir s'il vient de se
   * déconnecter lui-même pour retirer le cookie.
   */
  async revokeById(
    userId: string,
    sessionId: string,
    currentToken?: string | null,
  ): Promise<{ revoked: boolean; wasCurrent: boolean }> {
    const currentHash = currentToken ? hashToken(currentToken) : null;
    const [row] = await this.db
      .update(sessions)
      .set({ revokedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(
        and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)),
      )
      .returning({ tokenHash: sessions.tokenHash });

    if (!row) return { revoked: false, wasCurrent: false };
    return { revoked: true, wasCurrent: currentHash !== null && row.tokenHash === currentHash };
  }

  /**
   * Révoque toutes les sessions d'un compte sauf celle qui le demande.
   *
   * Garder la session courante est délibéré : le geste sert à couper les accès
   * oubliés, et se déconnecter soi-même au passage ferait douter qu'il ait
   * abouti. Sans jeton courant — appel administratif — tout est révoqué.
   */
  async revokeOthers(userId: string, currentToken?: string | null): Promise<number> {
    const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
    if (currentToken) conditions.push(ne(sessions.tokenHash, hashToken(currentToken)));

    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(and(...conditions))
      .returning({ id: sessions.id });
    return rows.length;
  }
}
