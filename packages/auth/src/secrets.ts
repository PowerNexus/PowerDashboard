import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Chiffrement réversible des secrets stockés (§5.4).
 *
 * À ne pas confondre avec le hachage des mots de passe et des jetons de
 * session : ceux-là ne sont jamais relus, seulement comparés, donc un condensat
 * suffit et vaut mieux. Ici le panel doit **récupérer la valeur d'origine** —
 * un jeton de node qu'il présente à Wings, un mot de passe de base de données
 * qu'il réaffiche au client. Un condensat rendrait l'opération impossible.
 *
 * C'est une distinction qui se paie cher quand on se trompe de sens : hacher ce
 * qu'il faudra relire oblige à tout réémettre, chiffrer ce qui aurait dû être
 * haché transforme une fuite de la base en fuite des mots de passe.
 *
 * La clé maître vient de l'environnement et se dérive dans le processus, sans
 * coffre ni HSM ; les données personnelles, elles, restent en clair : ADR 0007.
 */

const ALGORITHM = "aes-256-gcm";
/** Préfixe d'une valeur chiffrée sans contexte. Voir `decryptSecret` pour la forme antérieure. */
const FORMAT_VERSION = "v3";
/**
 * Préfixe d'une valeur **liée à sa place** : chiffrée avec un contexte
 * (données authentifiées additionnelles de GCM), qu'il faut redonner pour la
 * relire. Un préfixe à part, et non `v3:` avec ou sans contexte selon les cas :
 * la forme dit d'elle-même si le contexte est exigé, et les valeurs écrites
 * avant la liaison restent lisibles sans rien deviner (voir `decryptSecret`).
 */
const BOUND_FORMAT_VERSION = "v4";
/** 96 bits : taille recommandée pour GCM, et la seule où sa preuve tient. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      "APP_SECRET_KEY absente de l'environnement. Aucun secret ne peut être chiffré ni relu sans elle.",
    );
    this.name = "MissingEncryptionKeyError";
  }
}

/**
 * Longueur minimale de `APP_SECRET_KEY`, en caractères.
 *
 * Le sel de dérivation est public (il est écrit plus bas) : qui obtient une
 * copie de la base peut donc essayer des clés hors ligne, sans limite, contre
 * n'importe quel secret chiffré. scrypt ralentit chaque essai, il ne rend pas
 * un mot du dictionnaire introuvable. Trente-deux caractères écartent les
 * phrases de passe et les mots de passe d'usage ; les installateurs en
 * tirent soixante-quatre (`openssl rand -base64 48`).
 */
export const MIN_SECRET_KEY_LENGTH = 32;

export class WeakEncryptionKeyError extends Error {
  constructor(length: number) {
    super(
      `APP_SECRET_KEY trop courte (${length} caractères) : il en faut au moins ${MIN_SECRET_KEY_LENGTH}. ` +
        "Générez-la par « openssl rand -base64 48 ». Si des secrets sont déjà chiffrés avec " +
        "l'ancienne, ne la remplacez pas à la main : rechiffrez-les d'abord " +
        "(docs/runbooks/cle-maitre-secrets.md, rotation de la clé maître).",
    );
    this.name = "WeakEncryptionKeyError";
  }
}

/**
 * Dérive la clé de chiffrement depuis l'environnement.
 *
 * `scrypt` sur une valeur d'environnement plutôt que la valeur brute : la clé
 * fournie peut être une phrase de passe de longueur quelconque, alors qu'AES
 * exige exactement 32 octets. Le sel est fixe et public — il ne sert qu'à
 * séparer cet usage d'un autre, pas à protéger un secret, puisque la clé n'est
 * pas devinable.
 */

/**
 * Sel de dérivation. **Ne se change jamais seul.**
 *
 * Ce n'est pas une étiquette : c'est un paramètre cryptographique. Le modifier
 * dérive une autre clé à partir du même `APP_SECRET_KEY`, et tout ce qui a été
 * chiffré auparavant devient illisible d'un coup — jetons de daemon, mots de
 * passe de bases, secrets TOTP et de webhooks.
 *
 * C'est arrivé : un remplacement global de nom l'a emporté avec les libellés,
 * et le panel a perdu le jeton de son node dans la minute. La reprise se fait
 * par `scripts/rekey-secrets.mts`, qui déchiffre avec l'ancien sel et rechiffre
 * avec celui-ci — jamais par une retouche de cette ligne seule.
 *
 * Le `v2` est là pour ça : la prochaine évolution portera un numéro, et le
 * script de reprise ira avec.
 */
const KEY_DERIVATION_SALT = "gamedashboard.secrets.v2";

/**
 * Clé dérivée, mémorisée par valeur de secret.
 *
 * `scrypt` coûte volontairement cher — seize mégaoctets et quelques dizaines
 * de millisecondes, **synchrones**. Le payer à chaque lecture d'un jeton de
 * node, c'est-à-dire à chaque appel du daemon et à chaque sonde, bloquait la
 * boucle d'événements au rythme du trafic. Le secret ne change pas pendant la
 * vie du processus : la clé se calcule une fois.
 */
const derivedKeys = new Map<string, Buffer>();

function derivedKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const secret = env.APP_SECRET_KEY;
  if (!secret) throw new MissingEncryptionKeyError();
  if (secret.length < MIN_SECRET_KEY_LENGTH) throw new WeakEncryptionKeyError(secret.length);

  const cached = derivedKeys.get(secret);
  if (cached) return cached;

  const key = scryptSync(secret, KEY_DERIVATION_SALT, 32);
  derivedKeys.set(secret, key);
  return key;
}

/**
 * Vérifie au démarrage que la clé est là, assez longue, et se dérive.
 *
 * Sans cet appel, l'API démarre, répond « en bonne santé », et casse au
 * premier geste qui chiffre — c'est-à-dire au premier appel d'un node, dont
 * le jeton ne peut plus être relu. Mieux vaut refuser de démarrer.
 */
export function assertEncryptionKey(env: NodeJS.ProcessEnv = process.env): void {
  derivedKey(env);
}

/**
 * Chiffre une valeur. Le résultat est `v3:iv:tag:chiffré` sans contexte,
 * `v4:iv:tag:chiffré` avec, en base64url.
 *
 * Le vecteur d'initialisation est tiré au hasard à chaque appel : chiffrer deux
 * fois le même jeton produit deux valeurs différentes, sans quoi une simple
 * comparaison des colonnes révélerait que deux nodes partagent un secret.
 */
export function encryptSecret(
  plaintext: string,
  env?: NodeJS.ProcessEnv,
  /**
   * Contexte lié au chiffré (données authentifiées additionnelles), de la
   * forme `<table>.<colonne>:<id>` pour un secret rangé en base. GCM
   * authentifie le contenu, pas l'endroit où il est rangé : sans contexte,
   * deux chiffrés valides peuvent être échangés de colonne ou de ligne par
   * qui écrit en base — le secret TOTP d'un compte recopié sur un autre, le
   * jeton d'un node sur un autre. Avec, le déchiffrement exige le même
   * contexte. Chaque colonne chiffrée en passe un
   * (`apps/api/src/common/row-secrets.ts`).
   */
  context?: string,
): string {
  // Un contexte vide ne lierait à rien, tout en produisant la forme `v4:` qui
  // l'annonce : une erreur d'appelant, pas une valeur à écrire.
  if (context === "") throw new Error("Contexte de chiffrement vide.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, derivedKey(env), iv);
  if (context !== undefined) cipher.setAAD(Buffer.from(context, "utf8"));
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const parts = [iv, tag, encrypted].map((part) => part.toString("base64url"));
  // Le préfixe de version dit avec quel format — et demain, quelle clé — la
  // valeur a été produite, plutôt que de l'apprendre par un échec de GCM.
  const version = context === undefined ? FORMAT_VERSION : BOUND_FORMAT_VERSION;
  return `${version}:${parts.join(":")}`;
}

/**
 * Déchiffre une valeur produite par `encryptSecret`.
 *
 * L'étiquette d'authentification de GCM est vérifiée : une valeur modifiée en
 * base lève une exception au lieu de produire des octets arbitraires. C'est ce
 * qui distingue GCM d'un mode de chiffrement simple — sans cette vérification,
 * quelqu'un pouvant écrire en base pourrait altérer un jeton sans que rien ne
 * le signale.
 */
export function decryptSecret(payload: string, env?: NodeJS.ProcessEnv, context?: string): string {
  const split = payload.split(":");
  /*
   * Trois formes lisibles :
   * - `v4:iv:tag:données`, liée à sa place : le contexte est exigé ;
   * - `v3:iv:tag:données` et `iv:tag:données` (antérieure au préfixe), sans
   *   contexte. Elles se relisent sans données authentifiées, **même quand
   *   l'appelant fournit un contexte** : elles ont été écrites avant la
   *   liaison, et l'exiger les rendrait illisibles d'un coup. Chaque écriture
   *   les remplace par la forme liée, et `scripts/rekey-secrets.mts` lie d'un
   *   coup celles qui restent (runbook de la clé maître).
   *
   * Ramener une valeur `v4:` à l'une de ces formes ne dispense de rien : ses
   * données authentifiées sont dans le tag, qui ne se vérifie plus sans elles.
   */
  const bound = split.length === 4 && split[0] === BOUND_FORMAT_VERSION;
  const versioned = bound || (split.length === 4 && split[0] === FORMAT_VERSION);
  const parts = versioned ? split.slice(1) : split;
  if (parts.length !== 3) {
    throw new Error("Secret chiffré illisible : trois parties attendues.");
  }
  if (bound && context === undefined) {
    throw new Error("Secret chiffré lié à sa place : il ne se relit qu'avec son contexte.");
  }
  const [rawIv, rawTag, rawData] = parts as [string, string, string];

  // La longueur du tag est aussi imposée au déchiffreur, en plus du contrôle
  // ci-dessous : c'est lui qui a le dernier mot sur ce que GCM accepte.
  const decipher = createDecipheriv(ALGORITHM, derivedKey(env), Buffer.from(rawIv, "base64url"), {
    authTagLength: TAG_BYTES,
  });
  if (bound) decipher.setAAD(Buffer.from(context as string, "utf8"));
  const tag = Buffer.from(rawTag, "base64url");
  if (tag.length !== TAG_BYTES) {
    throw new Error("Secret chiffré illisible : étiquette d'authentification invalide.");
  }
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(Buffer.from(rawData, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** Vrai si la valeur a la forme produite par `encryptSecret`, ancienne, versionnée ou liée. */
export function looksEncrypted(value: string): boolean {
  const parts = value.split(":");
  if (parts.length === 4) return parts[0] === FORMAT_VERSION || parts[0] === BOUND_FORMAT_VERSION;
  return parts.length === 3;
}
