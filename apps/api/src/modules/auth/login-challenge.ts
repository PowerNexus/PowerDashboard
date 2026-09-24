import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "@gamedashboard/auth";

/**
 * Jetons d'attente scellés.
 *
 * Trois moments de l'authentification ont le même besoin : transporter « de
 * qui s'agit-il » d'une requête à la suivante, sans qu'aucune session ne soit
 * encore ouverte — l'attente du second facteur, et les deux cérémonies
 * WebAuthn, où le défi aléatoire doit revenir intact.
 *
 * Chiffrés plutôt que stockés en base. Le contenu est scellé par AES-256-GCM
 * avec la clé du panel : il est donc illisible et surtout **infalsifiable**,
 * une modification d'un seul octet faisant échouer le déchiffrement. Une table
 * de jetons en attente donnerait le même résultat au prix d'une écriture, d'une
 * lecture et d'un ménage pour des objets dont la durée de vie se compte en
 * minutes.
 *
 * Seule leur **consommation** s'écrit en base, par identifiant
 * (`AuthTokenRepository.claimChallenge`) : elle doit valoir pour toutes les
 * instances de l'API et survivre à un redémarrage, ce que le scellé ne sait
 * pas dire.
 *
 * Aucun de ces jetons ne vaut une session : ils ne donnent accès à rien.
 */

/**
 * Nature du jeton.
 *
 * Elle est scellée avec le reste et vérifiée à la lecture. Sans elle, un défi
 * obtenu pour **enregistrer** une clé d'accès pourrait être présenté pour
 * **s'authentifier** avec : deux cérémonies distinctes que rien ne
 * distinguerait plus une fois chiffrées.
 */
export type ChallengePurpose = "login" | "passkey-register" | "passkey-login";

/**
 * Durée de validité.
 *
 * Assez pour déverrouiller son téléphone, ouvrir l'application et recopier six
 * chiffres — ou approcher une clé USB — sans laisser traîner un demi-droit
 * d'accès toute la journée dans l'onglet de quelqu'un.
 */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

interface ChallengePayload {
  purpose: ChallengePurpose;
  userId: string;
  /** Identifiant unique : c'est lui qui rend le jeton consommable une fois. */
  jti: string;
  /** Défi aléatoire de la cérémonie WebAuthn. Absent pour un jeton de connexion. */
  webauthn?: string;
  /**
   * Par où la connexion avait commencé, avant que le second facteur
   * l'interrompe.
   *
   * Scellé avec le reste : la session ouverte à l'issue du second facteur doit
   * dire « SSO » quand l'entrée s'est faite par SSO, et le déduire après coup
   * est impossible — les deux chemins aboutissent à la même route.
   */
  method?: string;
  expiresAt: number;
}

export function issueChallenge(
  purpose: ChallengePurpose,
  userId: string,
  options: { webauthn?: string; method?: string; now?: number } = {},
): string {
  const now = options.now ?? Date.now();
  const payload: ChallengePayload = {
    purpose,
    userId,
    jti: randomUUID(),
    webauthn: options.webauthn,
    method: options.method,
    expiresAt: now + CHALLENGE_TTL_MS,
  };
  return encryptSecret(JSON.stringify(payload));
}

/** Contenu d'un défi lu et vérifié. */
export interface SealedChallenge {
  userId: string;
  /** Défi aléatoire de la cérémonie WebAuthn, ou `null`. */
  webauthn: string | null;
  method: string | null;
  /** Identifiant à consommer, une fois le défi servi. */
  jti: string;
  /** Échéance, en millisecondes : la trace de consommation vit jusque-là. */
  expiresAt: number;
}

/**
 * Rend le contenu du jeton, ou `null`.
 *
 * `null` couvre indistinctement le jeton expiré, tronqué, forgé, chiffré avec
 * une autre clé et **émis pour une autre cérémonie**. L'appelant n'a pas à les
 * distinguer : dans tous les cas il faut recommencer, et détailler la raison
 * renseignerait qui cherche à deviner le format.
 *
 * La lecture ne dit pas si le défi a **déjà servi** : c'est la base qui le
 * sait (`AuthTokenRepository.challengeClaimed`), et c'est elle qui le
 * consomme (`claimChallenge`). Cette liste vivait ici, en mémoire d'un
 * processus : un défi servi sur une instance de l'API se rejouait sur une
 * autre, ou sur la même après un redémarrage (NC-30).
 */
export function readChallenge(
  purpose: ChallengePurpose,
  token: string,
  now: number = Date.now(),
): SealedChallenge | null {
  let payload: ChallengePayload;
  try {
    payload = JSON.parse(decryptSecret(token)) as ChallengePayload;
  } catch {
    return null;
  }

  if (typeof payload?.userId !== "string" || typeof payload?.expiresAt !== "number") return null;
  // Sans identifiant, rien à consommer : un tel jeton se rejouerait sans fin.
  // Tous en portent depuis que la consommation existe, et un défi vit cinq
  // minutes — aucun ancien ne circule plus.
  if (typeof payload.jti !== "string" || payload.jti === "") return null;
  if (payload.purpose !== purpose) return null;
  if (payload.expiresAt <= now) return null;
  return {
    userId: payload.userId,
    webauthn: payload.webauthn ?? null,
    // Rendu tel quel : un défi émis avant cette fonctionnalité n'en porte pas,
    // et l'appelant retombe alors sur le mot de passe.
    method: payload.method ?? null,
    jti: payload.jti,
    expiresAt: payload.expiresAt,
  };
}
