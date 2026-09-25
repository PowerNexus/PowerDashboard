/**
 * Ce que la sonde retient d'un serveur de jeu, quel que soit son protocole.
 *
 * Une seule forme pour tous les jeux : elle est rangée telle quelle dans
 * `server_health.query_payload`, que lisent la vue joueurs
 * (`server-players.service.ts`), le compteur de la liste des serveurs et la
 * marketplace (`->> 'version'`). Un protocole qui en inventerait une autre
 * rendrait ses serveurs muets pour tous ces écrans.
 */
export interface GameStatus {
  /** Joueurs connectés. Jamais deviné : absent de la réponse, le champ vaut `null`. */
  playersOnline: number | null;
  playersMax: number | null;
  /** Version annoncée, telle quelle — « Paper 1.21.11 », « 1.0.2.3 »… */
  version: string | null;
  /**
   * Noms connus des joueurs. Parfois un **échantillon** (Minecraft en donne une
   * douzaine au plus). `null` quand la réponse n'en porte pas, pour ne pas le
   * confondre avec « personne ».
   */
  sample: string[] | null;
  /** Nom public du serveur, quand le protocole le donne (A2S, FiveM). */
  name?: string | null;
  /** Carte en cours, quand le protocole la donne (A2S). */
  map?: string | null;
}

/** Plafond des noms retenus : au-delà, un serveur modifié gonflerait la base à chaque sonde. */
export const PLAYER_SAMPLE_MAX = 100;

/** Longueur maximale d'un nom de joueur retenu. */
export const PLAYER_NAME_MAX_LENGTH = 64;

/** Longueur maximale d'un nom de serveur, d'une carte ou d'une version retenus. */
export const STATUS_TEXT_MAX_LENGTH = 128;

/**
 * Un texte venu du jeu, rendu inoffensif.
 *
 * Le serveur est contrôlé par le client : ce qu'il dit de lui-même est une
 * donnée douteuse. Caractères de contrôle retirés, blancs ramenés à une espace,
 * longueur bornée (par caractère, pas par unité UTF-16, pour ne jamais couper
 * un emoji en deux). Vide, il vaut `null`.
 */
export function cleanStatusText(raw: unknown, max = STATUS_TEXT_MAX_LENGTH): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    // biome-ignore lint/suspicious/noControlCharactersInRegex: on les retire.
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const bounded = Array.from(cleaned).slice(0, max).join("").trim();
  return bounded === "" ? null : bounded;
}

/**
 * Liste de noms, nettoyée, dédoublonnée et plafonnée.
 *
 * Les noms des jeux Steam et FiveM peuvent porter des espaces : ils sont
 * gardés pour l'affichage. Ce n'est pas ici qu'on décide s'ils peuvent entrer
 * dans une commande — `renderPlayerCommand` le refuse de lui-même, et la vue
 * joueurs ne propose d'action que sur un nom qu'il accepte.
 */
export function cleanPlayerNames(raw: readonly unknown[]): string[] {
  const names: string[] = [];
  for (const entry of raw) {
    const name = cleanStatusText(entry, PLAYER_NAME_MAX_LENGTH);
    if (name === null || names.includes(name)) continue;
    names.push(name);
    if (names.length >= PLAYER_SAMPLE_MAX) break;
  }
  return names;
}
