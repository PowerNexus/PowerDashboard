import type { AdminUserPatch, UserSuspensionInput } from "@gamedashboard/contracts";
import { type Database, users } from "@gamedashboard/db";
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { type AccountMailOutcome, AccountMailService } from "../auth/account-mail.service";
import { AuthTokenRepository } from "../auth/auth-token.repository";
import { SessionRepository } from "../auth/session.repository";
import { WingsClientService } from "../wings/wings-client.service";
import { WingsTokenService } from "../wings/wings-token.service";
import { isAdminRole } from "./admin.guard";

/**
 * Ce que l'administration fait d'un compte existant : le corriger, lui envoyer
 * un lien de réinitialisation, le suspendre.
 *
 * Séparé d'`AdminActionsService`, qui mêle serveurs, nodes et eggs : ces trois
 * gestes touchent à l'identité, et c'est là qu'une erreur coûte un compte. Ils
 * se relisent mieux ensemble.
 */

/** Seul rôle qui administre en écriture. Voir `AdminWriteGuard`. */
const WRITING_ROLE = "admin";

/** Ce que l'écran doit savoir d'une modification pour en rendre compte. */
export interface UserUpdateOutcome {
  emailChanged: boolean;
  /** Issue du courrier de vérification, quand l'adresse a changé. */
  verification: AccountMailOutcome | null;
}

@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(AuthTokenRepository) private readonly tokens: AuthTokenRepository,
    @Inject(AccountMailService) private readonly accountMail: AccountMailService,
    @Inject(WingsTokenService) private readonly wingsTokens: WingsTokenService,
    @Inject(WingsClientService) private readonly wings: WingsClientService,
  ) {}

  /**
   * Corrige l'état civil, l'adresse ou la langue d'un compte.
   *
   * **L'adresse suit la règle de l'inscription**, pas celle de la création par
   * l'administration. Un administrateur qui crée un compte et en transmet le
   * mot de passe répond de l'adresse ; un administrateur qui la *change* ne
   * sait pas si la nouvelle est lue — c'est souvent une faute de frappe qu'on
   * corrige. Elle repasse donc « non vérifiée », et le courrier de
   * vérification part vers la nouvelle boîte.
   *
   * Les liens encore valables partis vers l'**ancienne** boîte meurent au même
   * moment : un lien de réinitialisation qui dort dans une boîte qu'on vient
   * de retirer au compte resterait une clé de ce compte.
   *
   * **L'adresse d'un autre membre du personnel ne se change pas d'ici.**
   * L'adresse, c'est là où part la réinitialisation : un administrateur qui
   * réécrit celle d'un confrère puis lui envoie un lien prend son compte en
   * deux clics, et avec lui ce que la séparation des rôles protège. Le reste
   * de sa fiche se corrige, et chacun garde la main sur sa propre adresse.
   */
  async update(
    actorId: string,
    userId: string,
    patch: AdminUserPatch,
    ip: string | null,
  ): Promise<UserUpdateOutcome> {
    const [current] = await this.db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!current) throw new NotFoundException("Compte introuvable.");

    const emailChanged = current.email.toLowerCase() !== patch.email;

    if (emailChanged && actorId !== userId && isAdminRole(current.role)) {
      throw new ForbiddenException(
        "L'adresse d'un autre membre du personnel ne se change pas depuis l'administration : c'est à lui de la modifier depuis son compte.",
      );
    }

    if (emailChanged) {
      // Vérification explicite plutôt que de laisser l'index unique parler :
      // une erreur SQL brute ne dit pas quoi faire à qui remplit un formulaire.
      const [taken] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(and(sql`lower(${users.email}) = ${patch.email}`, ne(users.id, userId)))
        .limit(1);
      if (taken) {
        throw new ConflictException(
          "Un autre compte utilise déjà cette adresse. Choisissez-en une autre, ou supprimez d'abord le compte en double.",
        );
      }
    }

    await this.db
      .update(users)
      .set({
        email: patch.email,
        nameFirst: patch.nameFirst,
        nameLast: patch.nameLast,
        locale: patch.locale,
        ...(emailChanged ? { emailVerifiedAt: null } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId));

    if (!emailChanged) return { emailChanged, verification: null };

    await this.tokens.revokePending(userId, ["password_reset", "email_verify"]);
    // Le domaine de la plateforme, comme pour la réinitialisation ci-dessous.
    const verification = await this.accountMail.sendEmailVerification(
      { id: userId, email: patch.email },
      null,
      ip,
    );
    return { emailChanged, verification };
  }

  /**
   * Envoie au titulaire un lien pour choisir lui-même un nouveau mot de passe.
   *
   * **Le parcours est celui de « mot de passe oublié »**, jeton, courrier et
   * plafond compris. L'administrateur ne voit ni ne choisit jamais le secret :
   * il déclenche, le titulaire choisit. Contrairement à la route publique, qui
   * se tait sur tout pour ne rien apprendre à un inconnu, celle-ci dit
   * pourquoi rien n'est parti — l'administrateur a le droit de le savoir, et
   * c'est lui qui devra répondre au client.
   */
  async requestPasswordReset(userId: string, ip: string | null): Promise<{ sentTo: string }> {
    const [account] = await this.db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        suspendedAt: users.suspendedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!account) throw new NotFoundException("Compte introuvable.");

    if (account.suspendedAt !== null) {
      throw new ConflictException(
        "Ce compte est suspendu : un nouveau mot de passe ne lui rouvrirait rien. Réactivez-le d'abord.",
      );
    }
    // Même règle que la route publique : un compte sans mot de passe local
    // entre par son fournisseur d'identité, et lui en fabriquer un ouvrirait
    // une seconde porte que personne n'a demandée.
    if (!account.passwordHash) {
      throw new ConflictException(
        "Ce compte n'a pas de mot de passe local : il se connecte par un fournisseur d'identité ou par la facturation. Il n'y a rien à réinitialiser.",
      );
    }

    // Le domaine de la plateforme : l'administrateur n'arrive pas par le
    // domaine d'un revendeur, et deviner celui du client serait une erreur.
    const outcome = await this.accountMail.sendPasswordReset(account, null, ip);
    if (outcome === "mail_disabled") {
      throw new ServiceUnavailableException(
        "Aucun serveur de courrier n'est configuré : le lien ne pourrait pas partir. Renseignez le SMTP dans les réglages, puis recommencez.",
      );
    }
    if (outcome === "throttled") {
      throw new ConflictException(
        "Trois liens ont déjà été envoyés à ce compte dans l'heure. Attendez avant d'en demander un autre : le dernier reste valable.",
      );
    }

    return { sentTo: account.email };
  }

  /**
   * Suspend ou réactive un compte.
   *
   * **Ce que la suspension ferme** : toute ouverture de session (mot de passe,
   * clé d'accès, SSO, lien de la facturation — contrôle central dans
   * `SessionIssuerService`), les sessions déjà ouvertes (révoquées ici, et
   * refusées de toute façon par `SessionRepository.resolve`), les clés d'API
   * du compte, celles de sa boutique s'il est revendeur, le SFTP, les consoles
   * ouvertes et les liens envoyés par courrier.
   *
   * **Ce qu'elle laisse** : ses serveurs tournent. Suspendre un compte parce
   * qu'on s'interroge sur lui ne doit pas couper les joueurs qui sont dessus,
   * ni les clients d'un revendeur ; arrêter un serveur est un autre geste, la
   * suspension de serveur, qui existe déjà et se décide à part.
   *
   * Deux refus : **soi-même**, parce que l'on se couperait au milieu du geste ;
   * **le dernier administrateur actif**, parce qu'il n'y aurait plus personne
   * pour le réactiver, et la réparation passerait par la base.
   */
  async setSuspended(
    actorId: string,
    userId: string,
    input: UserSuspensionInput,
  ): Promise<{ suspended: boolean; revokedSessions: number; email: string }> {
    if (actorId === userId && input.suspended) {
      throw new ConflictException("Vous ne pouvez pas suspendre votre propre compte.");
    }

    const email = await this.db.transaction(async (tx) => {
      /*
       * Verrou sur les administrateurs actifs, cible comprise.
       *
       * Sans lui, deux administrateurs qui se suspendent l'un l'autre au même
       * instant passeraient chacun le décompte — « il en reste un autre » — et
       * la plateforme se retrouverait sans personne.
       */
      await tx.execute(
        sql`select 1 from ${users} where (${users.role} = ${WRITING_ROLE} and ${users.suspendedAt} is null) or ${users.id} = ${userId} for update`,
      );

      const [target] = await tx
        .select({ id: users.id, email: users.email, role: users.role })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!target) throw new NotFoundException("Compte introuvable.");

      if (input.suspended && target.role === WRITING_ROLE) {
        const [others] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(users)
          .where(
            and(eq(users.role, WRITING_ROLE), isNull(users.suspendedAt), ne(users.id, userId)),
          );
        if ((others?.n ?? 0) === 0) {
          throw new ConflictException(
            "C'est le dernier administrateur actif : le suspendre ne laisserait personne pour le réactiver. Nommez d'abord un autre administrateur.",
          );
        }
      }

      await tx
        .update(users)
        .set(
          input.suspended
            ? {
                // `coalesce` : suspendre un compte déjà suspendu met le motif à
                // jour sans effacer le moment où la suspension a commencé.
                suspendedAt: sql`coalesce(${users.suspendedAt}, now())`,
                suspensionReason: input.reason,
                updatedAt: new Date().toISOString(),
              }
            : { suspendedAt: null, suspensionReason: null, updatedAt: new Date().toISOString() },
        )
        .where(eq(users.id, userId));

      return target.email;
    });

    if (!input.suspended) return { suspended: false, revokedSessions: 0, email };

    // Après la validation, jamais avant : une révocation faite dans une
    // transaction annulée aurait déconnecté un compte resté actif.
    const revokedSessions = await this.sessions.revokeOthers(userId);
    await this.tokens.revokePending(userId, ["password_reset", "email_verify", "billing_sso"]);
    await this.closeConsoles(userId);

    return { suspended: true, revokedSessions, email };
  }

  /**
   * Ferme les consoles ouvertes par ce compte.
   *
   * Un jeton de console vit dix minutes et Wings ne revérifie pas le compte en
   * cours de route. Un node injoignable n'empêche pas la suspension : la
   * décision est prise en base, et le jeton expirera de lui-même.
   */
  private async closeConsoles(userId: string): Promise<void> {
    for (const [serverId, jtis] of this.wingsTokens.revocableForUser(userId)) {
      await this.wings.denyWebsocketTokens(serverId, jtis).catch(() => undefined);
    }
  }
}
