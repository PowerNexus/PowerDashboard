import { type ThrottleDecision, throttleDecision, verifyPassword } from "@gamedashboard/auth";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { type FailureStage, SecurityAlertService } from "./security-alert.service";
import { UserRepository } from "./user.repository";

const PasswordConfirmation = z.object({ password: z.string().min(1) });

/** Ce que la route sait de la requête : pour le verrou, la trace et l'alerte. */
export interface AttemptOrigin {
  ip: string | null;
  userAgent: string | null;
  /** Domaine d'arrivée, pour la marque et le lien du courriel d'alerte. */
  host: string | null;
}

/** Le compte relu après confirmation. */
export interface ConfirmedUser {
  id: string;
  email: string;
  nameFirst: string;
  nameLast: string;
}

/**
 * Issue d'une confirmation, que chaque contrôleur traduit dans sa propre
 * forme de réponse — l'un écrit sur la réponse Fastify, l'autre lève une
 * exception Nest.
 */
export type Confirmation =
  | { ok: true; user: ConfirmedUser }
  | {
      ok: false;
      status: 403 | 409 | 422 | 429;
      message: string;
      /** Pour l'en-tête `Retry-After`, quand le verrou est tombé. */
      retryAfterSeconds?: number;
    };

/**
 * Ce que devient la confirmation d'un compte sans mot de passe local — créé
 * par un fournisseur d'identité ou venu de la facturation.
 *
 * `refuse` pour ce qui **retire** une protection (désactiver le second
 * facteur, retirer une clé) : c'était la règle, elle ne change pas. `allow`
 * pour ce qui en **ajoute** une ou crée un accès : ce compte n'a aucun secret
 * à redonner, et le lui demander lui fermerait la double authentification et
 * le SFTP par clé sans rien protéger de plus. Sa ré-authentification relève
 * du fournisseur qui l'a fait entrer.
 */
export type WithoutLocalPassword = "refuse" | "allow";

/**
 * Le mot de passe redemandé avant un geste sensible (ASVS 3.7.1).
 *
 * Il vivait dans le contrôleur d'authentification. Il en sort parce que la
 * création d'une clé d'API, dans le module client, doit faire le même
 * contrôle : le recopier aurait fait deux verrous, et c'est toujours la copie
 * la moins lue qui oublie de compter un échec.
 *
 * Le verrou et la trace d'un échec vivent ici pour la même raison : la
 * connexion les emploie aussi, par ce service.
 */
@Injectable()
export class PasswordConfirmationService {
  constructor(
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(SecurityAlertService) private readonly alerts: SecurityAlertService,
  ) {}

  /** La décision du verrou, pour ce compte et cette adresse. */
  async throttle(email: string, ip: string | null): Promise<ThrottleDecision> {
    return throttleDecision(await this.users.recentFailures(email, ip));
  }

  /**
   * Consigne un échec, et prévient le titulaire au cinquième d'affilée (§5.1).
   *
   * `account` est nul pour une adresse inconnue : il n'y a alors personne à
   * prévenir, et rien n'entre au journal d'audit — l'identifiant saisi n'y
   * serait qu'une chaîne quelconque, parfois un mot de passe tapé dans le
   * mauvais champ. La réponse HTTP, elle, ne dépend pas de ce qui se passe
   * ici — l'alerte part en tâche détachée, sans rien attendre ni rien renvoyer,
   * si bien qu'un compte existant et une adresse inventée répondent pareil et
   * dans le même temps.
   */
  async recordFailure(
    email: string,
    origin: AttemptOrigin,
    account: { id: string; email: string } | null,
    stage: FailureStage,
  ): Promise<void> {
    await this.users.recordAttempt(email, origin.ip, false);
    if (!account) return;
    this.alerts.afterFailure({
      userId: account.id,
      email: account.email,
      ip: origin.ip,
      userAgent: origin.userAgent,
      host: origin.host,
      stage,
    });
  }

  /**
   * Relit le compte après confirmation de son mot de passe.
   *
   * Même verrou qu'à la connexion : une session volée ne vaut qu'un accès
   * temporaire, et deviner ici le mot de passe sans limite en ferait un accès
   * durable.
   */
  async confirm(
    userId: string,
    body: unknown,
    origin: AttemptOrigin,
    withoutLocalPassword: WithoutLocalPassword = "refuse",
  ): Promise<Confirmation> {
    const row = await this.users.findById(userId);
    if (!row)
      return { ok: false, status: 409, message: "Ce compte n'a pas de mot de passe local." };
    // Énumérés un par un : la ligne lue porte le condensat, qui n'a rien à
    // faire entre les mains d'un contrôleur.
    const user = { id: row.id, email: row.email, nameFirst: row.nameFirst, nameLast: row.nameLast };
    if (!row.passwordHash) {
      return withoutLocalPassword === "allow"
        ? { ok: true, user }
        : { ok: false, status: 409, message: "Ce compte n'a pas de mot de passe local." };
    }

    const parsed = PasswordConfirmation.safeParse(body);
    if (!parsed.success) return { ok: false, status: 422, message: "Mot de passe attendu." };

    const decision = await this.throttle(user.email, origin.ip);
    if (decision.action === "block") {
      return {
        ok: false,
        status: 429,
        message: "Trop de tentatives. Réessayez dans quelques minutes.",
        retryAfterSeconds: Math.ceil(decision.retryAfterMs / 1000),
      };
    }

    if (!(await verifyPassword(row.passwordHash, parsed.data.password))) {
      await this.recordFailure(user.email, origin, user, "reauthentication");
      await pause(decision.delayMs);
      return { ok: false, status: 403, message: "Mot de passe incorrect." };
    }

    return { ok: true, user };
  }
}

/**
 * L'origine d'une requête Fastify, lue comme le fait le contrôleur
 * d'authentification : l'adresse posée par le serveur, l'agent, et le domaine
 * d'arrivée que la couche web rapporte dans `x-gd-host`. Cet en-tête est
 * forgeable et ne choisit que la marque d'un courriel, jamais un accès.
 */
export function attemptOrigin(request: {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}): AttemptOrigin {
  const header = (name: string): string | null => {
    const value = request.headers?.[name];
    return (Array.isArray(value) ? value[0] : value) ?? null;
  };
  return {
    ip: request.ip ?? null,
    userAgent: header("user-agent"),
    host: header("x-gd-host")?.trim().toLowerCase() || null,
  };
}

export function pause(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
