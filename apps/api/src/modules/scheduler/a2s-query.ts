/**
 * Interrogation d'un serveur de jeu Steam par la requête A2S (« Source Query »).
 *
 * C'est le protocole que le navigateur de serveurs de Steam emploie pour
 * afficher un serveur : Rust, ARK, Counter-Strike, Garry's Mod, 7 Days to Die,
 * Valheim et tout jeu bâti sur Source ou le SDK de Steam y répondent, en UDP,
 * sans configuration côté serveur.
 *
 * Ce module ne fait que coder et décoder, comme `minecraft-ping.ts` : un
 * format se teste sans réseau. La socket vit dans `game-query.transport.ts`.
 *
 * Référence : https://developer.valvesoftware.com/wiki/Server_queries
 */

import { cleanPlayerNames, cleanStatusText, type GameStatus } from "./game-status";

/** En-tête d'une réponse tenant en un seul datagramme. */
const SINGLE_PACKET = -1;
/** En-tête d'une réponse découpée en plusieurs datagrammes. */
const SPLIT_PACKET = -2;

const A2S_INFO = 0x54;
const A2S_PLAYER = 0x55;
const S2C_CHALLENGE = 0x41;
const S2A_INFO = 0x49;
/** Ancienne réponse d'information des serveurs GoldSrc (Half-Life 1, CS 1.6). */
const S2A_INFO_GOLDSRC = 0x6d;
const S2A_PLAYER = 0x44;

/** Identifiant Steam de The Ship, qui glisse trois octets de plus dans sa réponse. */
const THE_SHIP_APP_ID = 2400;

/** Défi « aucun » : on demande au serveur de nous en donner un. */
const NO_CHALLENGE = Buffer.from([0xff, 0xff, 0xff, 0xff]);

/**
 * Demande d'information, avec le défi reçu du serveur quand il en exige un.
 *
 * Depuis fin 2020, les serveurs Source répondent à une première demande par un
 * défi (0x41) : il faut la renvoyer, défi en queue. Sans cela, un serveur sain
 * paraîtrait muet.
 */
export function buildInfoRequest(challenge?: Buffer): Buffer {
  const parts: Buffer[] = [
    Buffer.from([0xff, 0xff, 0xff, 0xff, A2S_INFO]),
    Buffer.from("Source Engine Query\0", "latin1"),
  ];
  if (challenge) parts.push(challenge);
  return Buffer.concat(parts);
}

/** Demande de la liste des joueurs : toujours précédée d'un défi, `FFFFFFFF` le réclame. */
export function buildPlayerRequest(challenge: Buffer = NO_CHALLENGE): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xff, 0xff, 0xff, A2S_PLAYER]), challenge]);
}

/** Ce que dit la réponse d'information. */
export interface A2sInfo {
  name: string | null;
  map: string | null;
  playersOnline: number;
  playersMax: number;
  version: string | null;
}

export type A2sResponse =
  | { kind: "challenge"; challenge: Buffer }
  | { kind: "info"; info: A2sInfo }
  | { kind: "players"; names: string[] }
  /**
   * Réponse en plusieurs datagrammes : refusée. Le réassemblage (et la
   * décompression bzip2 de certains jeux) coûterait plus qu'il ne rapporte à
   * une sonde : une liste de joueurs trop longue pour un datagramme se passe
   * de noms, et une information découpée n'arrive en pratique jamais.
   */
  | { kind: "split" };

/** Lecture séquentielle d'un datagramme ; toute lecture hors du tampon rend `null`. */
class Reader {
  private offset = 0;
  constructor(private readonly buffer: Buffer) {}

  get remaining(): number {
    return this.buffer.length - this.offset;
  }

  byte(): number | null {
    if (this.remaining < 1) return null;
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  short(): number | null {
    if (this.remaining < 2) return null;
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  skip(bytes: number): boolean {
    if (this.remaining < bytes) return false;
    this.offset += bytes;
    return true;
  }

  bytes(length: number): Buffer | null {
    if (this.remaining < length) return null;
    const value = Buffer.from(this.buffer.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  /** Chaîne terminée par un octet nul, décodée en UTF-8. `null` sans terminaison. */
  string(): string | null {
    const end = this.buffer.indexOf(0, this.offset);
    if (end === -1) return null;
    const value = this.buffer.subarray(this.offset, end).toString("utf8");
    this.offset = end + 1;
    return value;
  }
}

/**
 * Lit un datagramme reçu.
 *
 * `null` pour ce qui n'est pas une réponse A2S exploitable — trame tronquée,
 * type inconnu, service qui n'est pas un serveur de jeu. Le serveur de jeu est
 * contrôlé par le client : rien de ce qu'il envoie n'est cru sur parole.
 */
export function readA2sResponse(datagram: Buffer): A2sResponse | null {
  if (datagram.length < 5) return null;
  const header = datagram.readInt32LE(0);
  if (header === SPLIT_PACKET) return { kind: "split" };
  if (header !== SINGLE_PACKET) return null;

  const reader = new Reader(datagram.subarray(4));
  const type = reader.byte();

  switch (type) {
    case S2C_CHALLENGE: {
      const challenge = reader.bytes(4);
      return challenge ? { kind: "challenge", challenge } : null;
    }
    case S2A_INFO: {
      const info = readSourceInfo(reader);
      return info ? { kind: "info", info } : null;
    }
    case S2A_INFO_GOLDSRC: {
      const info = readGoldSrcInfo(reader);
      return info ? { kind: "info", info } : null;
    }
    case S2A_PLAYER: {
      const names = readPlayers(reader);
      return names ? { kind: "players", names } : null;
    }
    default:
      return null;
  }
}

function readSourceInfo(reader: Reader): A2sInfo | null {
  if (reader.byte() === null) return null; // version du protocole
  const name = reader.string();
  const map = reader.string();
  const folder = reader.string();
  const game = reader.string();
  const appId = reader.short();
  const players = reader.byte();
  const max = reader.byte();
  if (name === null || map === null || folder === null || game === null) return null;
  if (appId === null || players === null || max === null) return null;

  // Robots, type de serveur, environnement, visibilité, VAC.
  if (!reader.skip(5)) return null;
  // The Ship : mode, témoins, durée.
  if (appId === THE_SHIP_APP_ID && !reader.skip(3)) return null;

  return {
    name: cleanStatusText(name),
    map: cleanStatusText(map),
    playersOnline: players,
    playersMax: max,
    // La version peut manquer sur un serveur ancien : ce n'est pas une raison
    // de jeter une réponse par ailleurs complète.
    version: cleanStatusText(reader.string()),
  };
}

function readGoldSrcInfo(reader: Reader): A2sInfo | null {
  const address = reader.string();
  const name = reader.string();
  const map = reader.string();
  const folder = reader.string();
  const game = reader.string();
  const players = reader.byte();
  const max = reader.byte();
  if (address === null || name === null || map === null || folder === null || game === null) {
    return null;
  }
  if (players === null || max === null) return null;
  return {
    name: cleanStatusText(name),
    map: cleanStatusText(map),
    playersOnline: players,
    playersMax: max,
    version: null,
  };
}

/**
 * Noms de la liste des joueurs.
 *
 * Un joueur en cours de connexion apparaît sans nom : il est écarté. Une trame
 * tronquée garde ce qui a été lu en entier plutôt que de tout jeter — le
 * compteur, lui, vient de la réponse d'information.
 */
function readPlayers(reader: Reader): string[] | null {
  const count = reader.byte();
  if (count === null) return null;

  const raw: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (reader.byte() === null) break; // index
    const name = reader.string();
    // Score (entier) et durée (flottant) : sans intérêt ici.
    if (name === null || !reader.skip(8)) break;
    raw.push(name);
  }
  return cleanPlayerNames(raw);
}

/** Forme commune à tous les jeux, rangée dans `server_health.query_payload`. */
export function a2sStatus(info: A2sInfo, names: string[] | null): GameStatus {
  return {
    playersOnline: info.playersOnline,
    playersMax: info.playersMax,
    version: info.version,
    sample: names,
    name: info.name,
    map: info.map,
  };
}
