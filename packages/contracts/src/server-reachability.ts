/**
 * Quand un serveur est-il « tombé », et quand est-il « revenu » ?
 *
 * La sonde de jeu interroge chaque minute les serveurs censés tourner. Une
 * sonde manquée ne suffit pas à prévenir : un redémarrage de monde, un pic de
 * charge ou un paquet perdu en font manquer une de temps à autre, et un
 * propriétaire réveillé à tort finit par couper les alertes. Il en faut
 * `MISSES_BEFORE_ALERT` d'affilée.
 *
 * Le retour, lui, se déclare à la **première** réponse : un serveur qui
 * répond est joignable, et le dire tard ferait croire la panne plus longue.
 */

/** Sondes manquées d'affilée avant de déclarer un serveur injoignable. */
export const MISSES_BEFORE_ALERT = 3;

export type ReachabilityTransition = "down" | "up" | null;

/**
 * Transition à appliquer d'après les dernières sondes, **la plus récente en
 * premier**, et l'état connu (`unreachableSince` non nul : déjà déclaré tombé).
 */
export function reachabilityTransition(
  recent: readonly boolean[],
  alreadyDown: boolean,
): ReachabilityTransition {
  const [latest] = recent;
  if (latest === undefined) return null;

  if (alreadyDown) return latest ? "up" : null;
  if (recent.length < MISSES_BEFORE_ALERT) return null;
  return recent.slice(0, MISSES_BEFORE_ALERT).every((reachable) => !reachable) ? "down" : null;
}

/** Durée lisible d'une panne, pour la notification de retour. */
export function outageDuration(since: Date, until: Date): string {
  const minutes = Math.max(1, Math.round((until.getTime() - since.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
