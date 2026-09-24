/**
 * La vitrine `/design` n'existe qu'hors production (NC-53).
 *
 * Elle montre tous les composants dans les deux thèmes, sur des données
 * factices (`lib/mock.ts`) : un outil pour qui écrit un composant, pas un
 * écran du panel. En production elle répond « introuvable » et sort de la
 * navigation — un lien vers un 404 vaut moins que pas de lien.
 */
export function showcaseServed(): boolean {
  return process.env.NODE_ENV !== "production";
}
