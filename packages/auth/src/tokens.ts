import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Jetons opaques : sessions et clés d'API (§5.1).
 *
 * Aucun de ces jetons ne porte d'information. Un JWT stocké en cookie ne peut
 * pas être révoqué avant son expiration ; un identifiant opaque adossé à une
 * ligne en base se révoque immédiatement, ce qui est la seule chose qui compte
 * quand un appareil est perdu.
 */

/** 256 bits d'aléa. Encodé en base64url, cela donne 43 caractères. */
const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Condensat stocké en base.
 *
 * SHA-256 sans étirement, contrairement aux mots de passe, et c'est volontaire :
 * un jeton de 256 bits aléatoires n'est pas devinable par force brute, donc le
 * coût de calcul ne protégerait rien. Il rendrait en revanche chaque requête
 * authentifiée coûteuse, ce qui ouvre un déni de service.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Comparaison à durée constante.
 *
 * Une comparaison naïve s'arrête au premier octet différent : le temps de
 * réponse révèle alors combien de caractères sont corrects, ce qui permet de
 * reconstituer un jeton octet par octet. Les longueurs sont comparées d'abord
 * car `timingSafeEqual` exige des tampons de même taille — cela ne fuit rien,
 * la longueur d'un jeton étant publique.
 */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Nature d'une clé, inscrite en clair dans son préfixe.
 *
 * `app` désigne une clé de l'API applicative, celle qu'un système tiers —
 * facturation, boutique — présente. Elle se lit au premier coup d'œil dans un
 * journal ou une capture, ce qui est exactement ce qu'on veut : une clé `app`
 * aperçue dans un navigateur ou un dépôt public est une clé à révoquer, sans
 * avoir à la retrouver en base pour le savoir.
 */
export type ApiKeyEnvironment = "live" | "test" | "app";

export interface ApiKey {
  /** Partie stockée en clair, pour retrouver la ligne sans révéler le secret. */
  prefix: string;
  /** Condensat à écrire en base. */
  hash: string;
  /** Jeton complet, montré une seule fois et jamais reconstituable ensuite. */
  plaintext: string;
}

/**
 * Clé d'API de la forme `gd_live_<préfixe>_<secret>`.
 *
 * Le préfixe en clair sert deux choses : retrouver la ligne en base en une
 * lecture indexée plutôt qu'en comparant chaque condensat, et permettre aux
 * outils de détection de secrets de reconnaître une clé GameDashboard dans un
 * dépôt public. Le second point vaut autant que le premier : la plupart des
 * clés fuitent par un commit, pas par une attaque.
 */
const KEY_PREFIX = "gd";

/**
 * Le seul préfixe accepté.
 *
 * Un préfixe d'une époque antérieure du projet était accepté en plus, pour ne
 * pas invalider des clés déjà émises. Il ne l'est plus : aucune clé ne portait
 * ce préfixe, et le garder faisait mentir l'écran — qui annonçait encore aux
 * intégrateurs un préfixe que le panel n'émet plus depuis longtemps.
 */
const ACCEPTED_PREFIXES = [KEY_PREFIX];

export function generateApiKey(environment: ApiKeyEnvironment = "live"): ApiKey {
  const prefix = `${KEY_PREFIX}_${environment}_${randomBytes(6).toString("hex")}`;
  const secret = generateToken();
  const plaintext = `${prefix}_${secret}`;
  return { prefix, hash: hashToken(plaintext), plaintext };
}

/** Sépare le préfixe d'une clé présentée, sans rien valider. */
export function apiKeyPrefix(plaintext: string): string | null {
  const parts = plaintext.split("_");
  if (parts.length < 4) return null;
  if (!parts[0] || !ACCEPTED_PREFIXES.includes(parts[0])) return null;
  return parts.slice(0, 3).join("_");
}

export interface ExpirableToken {
  expiresAt: string;
  revokedAt?: string | null;
}

/**
 * Validité d'une session ou d'une clé.
 *
 * La révocation l'emporte sur l'expiration : une session révoquée reste en
 * base pour que l'utilisateur constate depuis /account/security qu'elle a bien
 * été fermée, et à quel moment.
 */
export function tokenValidity(
  token: ExpirableToken,
  now: number = Date.now(),
): "valid" | "revoked" | "expired" {
  if (token.revokedAt) return "revoked";
  if (new Date(token.expiresAt).getTime() <= now) return "expired";
  return "valid";
}
