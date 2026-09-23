import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { SecurityAlertService } from "./security-alert.service";
import { SESSION_COOKIE } from "./session.guard";
import { SESSION_TTL_MS, SessionRepository } from "./session.repository";
import { UserRepository } from "./user.repository";

/** Ce que lit quelqu'un dont le compte est suspendu, quelle que soit la porte. */
export const ACCOUNT_SUSPENDED_MESSAGE =
  "Ce compte est suspendu. Contactez le support de votre hébergeur pour en connaître la raison.";

/**
 * Le seul endroit qui ouvre une session.
 *
 * Il y a une douzaine de façons d'entrer dans ce panel — mot de passe, second
 * facteur, clé d'accès, fournisseur d'identité, lien venu de la facturation, et
 * maintenant invitation — et **une seule** doit savoir fabriquer une session.
 * Un second fabricant finit toujours par diverger d'un détail qui ne se voit
 * pas : un cookie sans `httpOnly`, une durée plus longue, une dernière
 * connexion jamais notée. Et c'est le chemin le moins fréquenté qui diverge,
 * donc celui qu'on éprouve le moins.
 *
 * Ce service était jusqu'ici une méthode privée du contrôleur
 * d'authentification. Il en sort parce qu'un second contrôleur en a besoin —
 * celui des invitations — et que l'alternative aurait été de recopier les
 * quatre gestes ailleurs.
 */

/** Ce que le service a besoin de savoir de la requête, et rien de plus. */
export interface SessionOrigin {
  ip: string | null;
  userAgent: string | null;
  /**
   * Pays, seulement quand un intermédiaire de confiance l'a fourni (voir
   * `trustedCountry`). Absent, l'alerte de nouvel appareil n'en parle pas.
   */
  country?: string | null;
  /** Domaine d'arrivée : marque et lien du courriel d'alerte. */
  host?: string | null;
}

/** Ce qu'il a besoin de faire à la réponse. Fastify le satisfait tel quel. */
export interface CookieSink {
  setCookie(name: string, value: string, options: Record<string, unknown>): unknown;
}

@Injectable()
export class SessionIssuerService {
  constructor(
    @Inject(SessionRepository) private readonly sessions: SessionRepository,
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(SecurityAlertService) private readonly alerts: SecurityAlertService,
  ) {}

  /**
   * Ouvre la session et pose le cookie. Rend le profil à renvoyer.
   *
   * `authMethod` est consigné avec la session : c'est **ici** qu'on sait par
   * quelle porte quelqu'un est entré, et nulle part ensuite.
   */
  async issue(
    userId: string,
    origin: SessionOrigin,
    reply: CookieSink,
    authMethod: string,
  ): Promise<{ user: unknown }> {
    /*
     * Un compte suspendu n'entre par **aucune** porte.
     *
     * Le contrôle est ici parce que c'est le seul point par lequel passent
     * toutes les connexions — mot de passe, second facteur, clé d'accès,
     * fournisseur d'identité, lien de la facturation, invitation. Le poser dans
     * chaque contrôleur ferait autant d'endroits à ne pas oublier, et c'est
     * toujours le chemin le moins fréquenté qu'on oublie.
     *
     * Le refus arrive après la preuve d'identité : seul celui qui tient déjà le
     * mot de passe ou la clé apprend que le compte est suspendu. Le motif, lui,
     * reste au support — c'est une note interne, pas un message au client.
     */
    if (await this.users.isSuspended(userId)) {
      throw new ForbiddenException(ACCOUNT_SUSPENDED_MESSAGE);
    }

    const token = await this.sessions.create(userId, {
      ip: origin.ip,
      userAgent: origin.userAgent,
      authMethod,
    });

    /*
     * La dernière connexion est notée ici, et nulle part ailleurs.
     *
     * Ce point est le seul par lequel toutes les sessions passent, et c'est ce
     * qui en fait le bon endroit : un seul écrivain, aucun chemin oublié.
     *
     * Sans attendre : l'horodatage décrit la connexion, il ne la conditionne
     * pas. Faire échouer une ouverture de session parce que la trace n'a pas pu
     * être écrite serait absurde.
     */
    void this.users.noteLogin(userId);

    /*
     * Nouvel appareil ou nouveau réseau ? (§5.1)
     *
     * Ici, parce que c'est ici que passent **toutes** les connexions : mot de
     * passe (avec ou sans second facteur), clé d'accès, authentification
     * unique, lien venu de la facturation, inscription, invitation. Une alerte
     * posée dans chaque route aurait oublié la moins fréquentée — et c'est par
     * elle qu'entre celui qu'on n'attend pas.
     *
     * Détachée : la réponse n'attend ni la base ni le serveur SMTP.
     */
    this.alerts.afterSignIn({
      userId,
      token,
      ip: origin.ip,
      userAgent: origin.userAgent,
      country: origin.country ?? null,
      host: origin.host ?? null,
      authMethod,
    });

    /*
     * La ligne lue en base porte le condensat du mot de passe. Seuls les champs
     * d'affichage sortent de `resolve`, énumérés un par un plutôt que retirés
     * par omission : ajouter demain une colonne sensible ne doit pas la faire
     * fuiter automatiquement.
     */
    const user = await this.sessions.resolve(token);

    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      // Inaccessible au JavaScript de la page : une XSS ne peut pas voler la
      // session, seulement agir pendant que l'utilisateur est présent.
      httpOnly: true,
      // `lax` et non `strict` : `strict` casserait le retour depuis un
      // fournisseur OAuth externe.
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_TTL_MS / 1000,
    });

    return { user };
  }
}
