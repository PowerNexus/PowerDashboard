/**
 * Cookies d'authentification : leur nom et leurs attributs.
 *
 * **Une seule règle pour l'API et l'interface**, parce que l'une pose ce que
 * l'autre lit. L'API émet le cookie de session, l'interface le recopie vers le
 * navigateur puis le renvoie à l'API à chaque appel : deux copies de la règle
 * finiraient par nommer le cookie différemment, et la connexion échouerait
 * sans rien dire — l'API poserait `gd_session`, l'interface chercherait
 * `__Host-gd_session`.
 *
 * L'environnement est passé en argument plutôt que lu ici : ce paquet ne
 * suppose pas Node, et l'API doit le relire **à l'appel** (son `.env` est
 * chargé après l'évaluation des modules).
 */

/**
 * Durée de vie maximale d'une session, quelle que soit l'activité : douze
 * heures (ASVS 3.3.2, niveau 2).
 *
 * L'API refuse la session au-delà, et le cookie du navigateur meurt au même
 * moment : un cookie qui survivrait à sa session ferait voir un refus à chaque
 * page au lieu de l'écran de connexion. Elle durait sept jours ; l'expiration
 * d'inactivité, elle, n'existe que côté API (`SESSION_IDLE_MS`).
 */
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Ce que la règle lit de l'environnement, et rien d'autre. */
export interface CookieEnvironment {
  NODE_ENV?: string;
  /** Origine publique du panel, telle que le navigateur la voit. */
  PANEL_ORIGIN?: string;
}

/**
 * Les cookies d'authentification exigent-ils HTTPS ?
 *
 * Oui en production, et **dès que le panel est servi en HTTPS**. `NODE_ENV`
 * seul ne suffisait pas : `deploy.sh` le pose, mais ni les unités systemd ni
 * `app.sh` ne le font, et un panel public posait alors sa session sans
 * `Secure` — lisible par quiconque intercepte une requête égarée en clair.
 * L'origine, elle, est toujours déclarée, puisque le contrôle d'origine et
 * les clés d'accès en dépendent.
 *
 * Hors production sur une origine HTTP (le poste de développement), le
 * navigateur refuserait `Secure` et `__Host-` : le cookie reste en clair.
 */
export function cookiesRequireHttps(env: CookieEnvironment): boolean {
  if (env.NODE_ENV === "production") return true;
  return /^https:\/\//i.test(env.PANEL_ORIGIN?.trim() ?? "");
}

/**
 * Nom du cookie de session.
 *
 * `__Host-` dès que HTTPS est exigé : le navigateur n'accepte alors le cookie
 * que s'il est `Secure`, sans attribut `Domain` et sur le chemin `/`. Un
 * sous-domaine — un domaine revendeur, ou tout hôte voisin — ne peut donc pas
 * en poser un du même nom qui serait envoyé à sa place.
 */
export function sessionCookieName(env: CookieEnvironment): string {
  return cookiesRequireHttps(env) ? "__Host-gd_session" : "gd_session";
}

/**
 * Nom du cookie où dort le jeton de l'agent pendant une prise en main.
 *
 * Même préfixe que la session, sous la même condition : il porte **une
 * session du personnel**, et un sous-domaine qui en poserait un du même nom
 * choisirait la session rouverte au retour.
 */
export function impersonationReturnCookieName(env: CookieEnvironment): string {
  return cookiesRequireHttps(env) ? "__Host-gd_return" : "gd_return";
}

/**
 * Attributs communs des cookies d'authentification, **à la pose comme à
 * l'effacement**.
 *
 * L'effacement compte autant que la pose : pour un nom en `__Host-`, le
 * navigateur ignore un `Set-Cookie` sans `Secure`, y compris celui qui
 * efface. Une déconnexion qui l'oublie laisse le cookie en place.
 *
 * - `httpOnly` : une XSS ne peut pas voler la session, seulement agir pendant
 *   que l'utilisateur est présent.
 * - `lax` et non `strict` : `strict` casserait le retour depuis un
 *   fournisseur OAuth externe.
 */
export function authCookieAttributes(env: CookieEnvironment): {
  path: "/";
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
} {
  return { path: "/", httpOnly: true, sameSite: "lax", secure: cookiesRequireHttps(env) };
}
