import {
  authCookieAttributes,
  cookiesRequireHttps,
  sessionCookieName,
} from "@gamedashboard/contracts";

/**
 * Nom du cookie de session, partagé par tout ce qui le lit ou le pose.
 *
 * `__Host-` dès que le panel exige HTTPS — en production, ou servi sur une
 * origine `https://` même sans `NODE_ENV` : le navigateur n'accepte alors le
 * cookie que s'il est `Secure`, sans attribut `Domain` et sur le chemin `/`.
 * Sur le poste de développement, servi en clair, ce préfixe serait refusé : le
 * nom reste nu.
 *
 * La règle vit dans `contracts` et l'API applique la même (`session.guard.ts`) :
 * l'une pose ce que l'autre lit. Une constante suffit ici — Next charge
 * l'environnement avant d'évaluer le moindre module, ce que l'API ne fait pas.
 */
export const SESSION_COOKIE = sessionCookieName(process.env);

/**
 * `Secure` pour les cookies de ce panel qui n'ont pas les attributs communs
 * (cérémonie OAuth, défi de second facteur) : même règle, autre chemin.
 */
export const SECURE_COOKIES = cookiesRequireHttps(process.env);

/**
 * Attributs des cookies d'authentification, **à la pose comme à l'effacement**.
 *
 * Recopiés de la règle commune plutôt que déduits de la réponse de l'API : lire
 * les attributs qu'elle renvoie reviendrait à la laisser décider du `httpOnly`
 * du navigateur. Et un effacement sans `Secure` est ignoré pour un nom en
 * `__Host-` : la déconnexion laissait le cookie en place.
 */
export const AUTH_COOKIE_OPTIONS = authCookieAttributes(process.env);
