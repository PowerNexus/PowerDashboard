/**
 * Limitation des tentatives de connexion (§5.1).
 *
 * Le comptage se fait sur deux axes, et ce n'est pas une redondance :
 * - par compte seul, n'importe qui peut verrouiller n'importe quel utilisateur
 *   en échouant volontairement, ce qui transforme la protection en arme ;
 * - par IP seule, une attaque répartie sur mille adresses passe sans être vue.
 *
 * On applique donc la décision la plus restrictive des deux.
 */

export const ATTEMPT_WINDOW_MS = 15 * 60_000;
/** Au-delà, l'utilisateur est prévenu par e-mail qu'on essaie d'entrer chez lui. */
export const ALERT_AFTER_ATTEMPTS = 5;
export const MAX_ATTEMPTS_PER_ACCOUNT = 10;
/** Plus haut pour une IP : un foyer ou un bureau partage une adresse publique. */
export const MAX_ATTEMPTS_PER_IP = 30;

export interface AttemptCounts {
  account: number;
  ip: number;
}

export type ThrottleDecision =
  | { action: "allow"; delayMs: number }
  | { action: "block"; retryAfterMs: number; reason: "account" | "ip" };

/**
 * Délai progressif appliqué avant de répondre.
 *
 * Il double à chaque échec à partir du troisième et plafonne à 5 secondes.
 * Le but n'est pas de gêner un humain qui se trompe deux fois, mais de rendre
 * une énumération automatisée assez lente pour être inutile.
 */
export function attemptDelayMs(failures: number): number {
  if (failures < 3) return 0;
  return Math.min(5_000, 2 ** (failures - 3) * 250);
}

export function throttleDecision(counts: AttemptCounts): ThrottleDecision {
  if (counts.account >= MAX_ATTEMPTS_PER_ACCOUNT) {
    return { action: "block", retryAfterMs: ATTEMPT_WINDOW_MS, reason: "account" };
  }
  if (counts.ip >= MAX_ATTEMPTS_PER_IP) {
    return { action: "block", retryAfterMs: ATTEMPT_WINDOW_MS, reason: "ip" };
  }
  return { action: "allow", delayMs: attemptDelayMs(Math.max(counts.account, counts.ip)) };
}

/** Vrai au franchissement exact du seuil : l'alerte part une fois, pas à chaque échec suivant. */
export function shouldAlertOwner(accountFailures: number): boolean {
  return accountFailures === ALERT_AFTER_ATTEMPTS;
}

export type LoginOutcome =
  | { result: "ok" }
  | { result: "rejected"; reason: "credentials" | "locked" | "throttled" };

/**
 * Réponse à présenter à l'appelant.
 *
 * Un compte inexistant et un mot de passe faux donnent la même réponse : toute
 * distinction transforme le formulaire de connexion en outil d'énumération des
 * comptes, et savoir qu'une adresse est cliente est déjà une fuite.
 */
export function publicFailureMessage(): string {
  return "Identifiants invalides.";
}
