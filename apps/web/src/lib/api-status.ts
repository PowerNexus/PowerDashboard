/**
 * Ce que la frontière d'erreur a le droit de savoir.
 *
 * Next ne transmet pas les erreurs du serveur au client : il en garde le
 * `digest` et remplace le message par un texte générique dès qu'on n'est plus
 * en développement. Une frontière qui reconnaît la panne en lisant le message
 * marche donc sur le poste du développeur et nulle part ailleurs — c'est le
 * genre de défaut qu'on ne découvre qu'en production, sur l'écran qui devait
 * justement expliquer la panne.
 *
 * Ces jetons sont posés comme `digest` sur l'erreur levée côté serveur. Next
 * les laisse passer tels quels, et la frontière peut alors décider quoi
 * afficher sans rien deviner.
 *
 * Ce fichier ne contient que des constantes : il est importé des deux côtés de
 * la frontière, et y ajouter quoi que ce soit qui touche au serveur ferait
 * échouer le rendu client.
 */

/** L'API n'a pas répondu du tout : processus arrêté, mauvais port, réseau coupé. */
export const API_OFFLINE_DIGEST = "yh:api-offline";

/** L'API a accepté la connexion mais n'a pas répondu à temps. */
export const API_TIMEOUT_DIGEST = "yh:api-timeout";

export type ApiFailureKind = "offline" | "timeout" | "http";

/** Traduit un `digest` en cause, ou `null` si l'erreur vient d'ailleurs. */
export function apiFailureFromDigest(digest: string | undefined): ApiFailureKind | null {
  if (digest === API_OFFLINE_DIGEST) return "offline";
  if (digest === API_TIMEOUT_DIGEST) return "timeout";
  return null;
}
