import { createHash } from "node:crypto";

/**
 * Clés publiques SSH, pour l'authentification SFTP par clé.
 *
 * Wings délègue entièrement la décision au panel : il lui envoie la clé
 * proposée par le client, au format `authorized_keys`, et attend un accord ou
 * un refus. Ce qui suit sert donc à reconnaître une clé enregistrée, jamais à
 * vérifier une signature — la cryptographie de la session SSH est faite par le
 * daemon, pas ici.
 */

/**
 * Algorithmes acceptés.
 *
 * Liste fermée, et volontairement courte. `ssh-dss` (DSA) en est absent : il
 * est cassé, refusé par OpenSSH depuis des années, et l'accepter ici
 * reviendrait à proposer une porte que le serveur d'en face n'ouvrira pas.
 * `ssh-rsa` reste, parce que des clés existantes en dépendent encore.
 */
const ALGORITHMS = new Set([
  "ssh-ed25519",
  "sk-ssh-ed25519@openssh.com",
  "ssh-rsa",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "sk-ecdsa-sha2-nistp256@openssh.com",
]);

export interface SshPublicKey {
  algorithm: string;
  /** Corps binaire, en base64, tel qu'il est écrit dans `authorized_keys`. */
  body: string;
  /** Commentaire de fin de ligne, souvent « utilisateur@machine ». */
  comment: string;
  /** Empreinte `SHA256:…`, celle qu'affiche `ssh-keygen -lf`. */
  fingerprint: string;
}

export type SshKeyProblem =
  | "malformed"
  | "unsupported-algorithm"
  | "invalid-body"
  | "algorithm-mismatch";

/**
 * Lit une ligne `authorized_keys`.
 *
 * Rend le problème plutôt qu'une exception : cette fonction sert aussi bien à
 * valider une saisie — où le motif doit être affiché — qu'à reconnaître la clé
 * envoyée par le daemon, où toute distinction serait un renseignement donné à
 * qui essaie des clés au hasard.
 *
 * Aucune tolérance sur la forme : une clé se copie depuis un fichier, jamais à
 * la main. « Réparer » une saisie enregistrerait une clé que l'utilisateur n'a
 * pas donnée, et l'échec se chercherait ensuite du côté du client SSH.
 */
export function parseSshPublicKey(line: string): SshPublicKey | SshKeyProblem {
  // Les options de `authorized_keys` (`command=`, `no-pty`…) ne sont pas
  // acceptées : elles ne veulent rien dire ici, et une clé collée avec ses
  // options viendrait d'un fichier qu'on n'a pas lu.
  const parts = line.trim().split(/\s+/);
  if (parts.length < 2) return "malformed";

  const [algorithm, body, ...rest] = parts;
  if (algorithm === undefined || body === undefined) return "malformed";
  if (!ALGORITHMS.has(algorithm)) return "unsupported-algorithm";

  let decoded: Buffer;
  try {
    decoded = Buffer.from(body, "base64");
    // `Buffer.from` ne se plaint jamais : il ignore ce qu'il ne sait pas lire.
    // Le seul contrôle qui vaille est le retour au base64 d'origine.
    if (decoded.length === 0 || decoded.toString("base64") !== body) return "invalid-body";
  } catch {
    return "invalid-body";
  }

  /*
   * Le corps répète l'algorithme, et les deux doivent concorder.
   *
   * Sans ce contrôle, une clé RSA annoncée `ssh-ed25519` s'enregistrerait
   * comme telle ; l'empreinte porterait alors sur un corps que le client ne
   * proposera jamais sous ce nom, et la connexion échouerait sans motif.
   */
  const declared = readString(decoded);
  if (declared !== algorithm) return "algorithm-mismatch";

  return {
    algorithm,
    body,
    comment: rest.join(" "),
    fingerprint: fingerprintOf(decoded),
  };
}

/**
 * Empreinte au format d'OpenSSH : `SHA256:` suivi du condensat en base64,
 * **sans le remplissage**. C'est ce que `ssh-keygen -lf` affiche, et c'est donc
 * ce que l'utilisateur peut comparer avec ce que montre l'écran.
 */
export function fingerprintOf(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

/**
 * Première chaîne du corps, au format SSH : quatre octets de longueur en gros
 * boutiste, puis les octets. Rend `null` quand la longueur annoncée dépasse ce
 * qui reste — un corps tronqué ou fabriqué.
 */
function readString(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  const length = buffer.readUInt32BE(0);
  if (length > buffer.length - 4) return null;
  return buffer.subarray(4, 4 + length).toString("utf8");
}
