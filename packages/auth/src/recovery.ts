import { randomInt } from "node:crypto";

/**
 * Codes de secours.
 *
 * Ce sont eux qui empêchent qu'un téléphone perdu devienne un compte perdu.
 * Sans eux, activer la double authentification revient à parier son accès sur
 * un appareil, et la seule issue serait de passer par le support — qui devrait
 * alors désactiver la protection sur simple demande, c'est-à-dire l'annuler.
 */

/** Dix codes : assez pour survivre à plusieurs pertes, assez peu pour être imprimés. */
export const RECOVERY_CODE_COUNT = 10;

/**
 * Alphabet des codes.
 *
 * Ni `I`, ni `O`, ni `0`, ni `1` : ces codes sont recopiés à la main depuis un
 * papier, souvent dans l'urgence, et confondre un zéro et un O fait accuser le
 * code alors que c'est la police de caractères qui ment.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Cinq caractères par groupe, deux groupes : 10 caractères, ~50 bits. */
const GROUP_LENGTH = 5;
const GROUPS = 2;

/**
 * Engendre un lot de codes.
 *
 * `randomInt` plutôt qu'un modulo sur des octets : 256 n'étant pas un multiple
 * de 32... il l'est ici, mais l'alphabet changera un jour, et un modulo
 * biaisé sur un alphabet de 33 caractères produirait des codes moins aléatoires
 * qu'annoncé sans que rien ne le signale.
 */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () =>
    Array.from({ length: GROUPS }, () =>
      Array.from({ length: GROUP_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""),
    ).join("-"),
  );
}

/**
 * Forme canonique d'un code saisi.
 *
 * Majuscules, sans tiret ni espace : c'est cette forme qui est hachée. Le
 * séparateur n'est qu'une aide à la lecture, et refuser un code parce qu'il a
 * été recopié sans tiret ferait croire à un code invalide.
 */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]+/g, "").toUpperCase();
}
