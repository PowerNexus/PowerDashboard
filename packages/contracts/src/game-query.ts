/**
 * Sonde de jeu déclarée par l'egg.
 *
 * La sonde parle au jeu **comme un joueur** : encore faut-il savoir quelle
 * langue il parle, et sur quel port. Pterodactyl ne le déclare pas ; le panel
 * le devine au nom de l'egg, ce qui suffit pour les eggs courants mais pas pour
 * un egg maison. Un egg peut donc le **dire**, dans une clé propre à
 * GameDashboard, `game_query`, que Pterodactyl ignore à l'import et que Wings
 * ne voit jamais :
 *
 * ```json
 * "game_query": { "protocol": "a2s", "port_variable": "QUERY_PORT", "port_offset": 1 }
 * ```
 *
 * - `protocol` : `minecraft` (Server List Ping, TCP), `a2s` (requête Steam,
 *   UDP : Rust, ARK, Source…) ou `cfx` (FiveM et RedM, `/info.json` en HTTP) ;
 * - `port_variable` : variable de l'egg qui porte le port de requête, quand il
 *   diffère du port de jeu (`QUERY_PORT`) ;
 * - `port_offset` : décalage par rapport au port principal, appliqué quand la
 *   variable est absente ou vide (Valheim répond sur le port de jeu + 1).
 */

export const GAME_QUERY_PROTOCOLS = ["minecraft", "a2s", "cfx"] as const;
export type GameQueryProtocol = (typeof GAME_QUERY_PROTOCOLS)[number];

export function isGameQueryProtocol(value: unknown): value is GameQueryProtocol {
  return typeof value === "string" && (GAME_QUERY_PROTOCOLS as readonly string[]).includes(value);
}

/** La déclaration telle que l'egg la porte, clés comprises. */
export interface GameQuery {
  protocol: GameQueryProtocol;
  port_variable?: string;
  port_offset?: number;
}

/** Nom de variable d'environnement admissible, comme ceux des eggs. */
const ENV_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]{0,119}$/;

/** Décalage admissible : au-delà, ce n'est plus un décalage mais un autre port. */
export const GAME_QUERY_MAX_OFFSET = 1000;

/**
 * Lit la clé `game_query` d'un egg.
 *
 * Sans protocole connu, la déclaration entière est écartée (`null`) : la sonde
 * retombe alors sur la reconnaissance par le nom. Un champ facultatif douteux
 * est écarté seul, comme une commande mal écrite dans `player_commands`.
 */
export function readGameQuery(raw: unknown): GameQuery | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (!isGameQueryProtocol(body.protocol)) return null;

  const query: GameQuery = { protocol: body.protocol };
  const variable = typeof body.port_variable === "string" ? body.port_variable.trim() : "";
  if (ENV_VARIABLE.test(variable)) query.port_variable = variable;
  const offset = body.port_offset;
  if (
    typeof offset === "number" &&
    Number.isInteger(offset) &&
    offset !== 0 &&
    Math.abs(offset) <= GAME_QUERY_MAX_OFFSET
  ) {
    query.port_offset = offset;
  }
  return query;
}
