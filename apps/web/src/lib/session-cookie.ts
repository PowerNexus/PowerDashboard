/**
 * Nom du cookie de session, partagé par tout ce qui le lit ou le pose.
 *
 * En production, le préfixe `__Host-` : le navigateur n'accepte alors le
 * cookie que s'il est `Secure`, sans attribut `Domain` et sur le chemin `/`.
 * Un sous-domaine — un domaine revendeur, ou tout hôte voisin — ne peut donc
 * pas en poser un du même nom qui serait envoyé à sa place. Hors production
 * le panel est servi en clair, où ce préfixe est refusé : le nom reste nu.
 *
 * L'API applique la même règle (`session.guard.ts`) ; les deux doivent rester
 * d'accord, puisque l'une pose ce que l'autre lit.
 */
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-gd_session" : "gd_session";
