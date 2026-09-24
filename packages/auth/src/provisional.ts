import { randomBytes } from "node:crypto";
import { PASSWORD_MIN_LENGTH } from "./policy";

/**
 * Mots de passe provisoires des scripts d'exploitation (ASVS 2.3.1).
 *
 * `create-admin` et `reset-password` tirent un secret au sort et l'affichent
 * une fois dans un terminal. Rien ne l'empêchait de devenir le mot de passe
 * durable du compte : il restait dans l'historique d'un écran partagé, dans
 * une capture, dans le presse-papiers. Il porte désormais une échéance ; passé
 * ce délai, la connexion le refuse, et avant, elle demande d'en changer.
 *
 * Vingt-quatre heures : le temps d'aller jusqu'à un navigateur, pas celui
 * d'oublier qu'on devait en changer.
 */
export const PROVISIONAL_PASSWORD_TTL_MS = 24 * 60 * 60_000;

/**
 * Le mot de passe d'un script : tiré au sort, sauf si l'opérateur en impose un.
 *
 * **Un mot de passe choisi n'expire pas.** Ce n'est pas un secret initial
 * généré par le panel : l'opérateur le connaît déjà, et le CI s'en sert pour
 * jouer le parcours de connexion — le forcer au changement casserait la suite
 * de bout en bout sans rien protéger. Trop court, il est ignoré et le tirage
 * au sort reprend la main, comme avant.
 */
export function provisionalPassword(
  imposed?: string | null,
  now: Date = new Date(),
): { password: string; expiresAt: Date | null; imposed: boolean } {
  const chosen = imposed?.trim();
  if (chosen && [...chosen].length >= PASSWORD_MIN_LENGTH) {
    return { password: chosen, expiresAt: null, imposed: true };
  }
  return {
    // base64url : pas de caractère qu'un terminal ou un copier-coller abîme.
    password: randomBytes(24).toString("base64url"),
    expiresAt: new Date(now.getTime() + PROVISIONAL_PASSWORD_TTL_MS),
    imposed: false,
  };
}

export type PasswordStanding = "valid" | "provisional" | "expired";

/**
 * Où en est le mot de passe d'un compte, d'après son échéance.
 *
 * `valid` sans échéance — le cas de tout mot de passe choisi par son
 * titulaire —, `provisional` avant, `expired` à partir de l'échéance.
 */
export function passwordStanding(
  expiresAt: string | Date | null,
  now: Date = new Date(),
): PasswordStanding {
  if (expiresAt === null) return "valid";
  return new Date(expiresAt).getTime() > now.getTime() ? "provisional" : "expired";
}
