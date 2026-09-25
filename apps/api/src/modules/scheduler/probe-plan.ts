import { type GameQueryProtocol, readGameQuery } from "@gamedashboard/contracts";
import { detectRuntime } from "../marketplace/server-runtime";

/**
 * Comment sonder un serveur : quel protocole, sur quel port.
 *
 * Par ordre de confiance :
 *
 * 1. **Ce que l'egg déclare** (`game_query`) : son auteur sait mieux que nous.
 * 2. **Minecraft**, reconnu comme ailleurs dans le panel (`detectRuntime`, par
 *    le nom de l'egg et du nest) : c'était la seule sonde, elle ne change pas.
 * 3. **Les autres jeux**, reconnus au nom de l'egg, du nest, à l'image et à la
 *    commande de démarrage (`GAME_RULES`).
 *
 * Rien de reconnu, rien de sondé : parler A2S à un serveur qui ne le parle pas
 * le ferait déclarer en panne chaque minute, et une alerte fausse coûte plus
 * qu'une sonde absente.
 */

export interface ProbePlanInput {
  eggName: string;
  nestName: string;
  /** Image Docker du serveur. */
  image: string;
  /** Commande de démarrage du serveur. */
  startup: string;
  /** Colonne `eggs.game_query`, telle quelle. */
  declared: unknown;
  /** Valeurs des variables du serveur, par nom d'environnement. */
  variables: Record<string, string>;
  /** Port principal (celui de l'allocation). */
  port: number;
  /**
   * Ports de toutes les allocations du serveur, principal compris. Un port lu
   * dans une variable n'est retenu que s'il en fait partie : le client règle
   * ses variables, et le panel ne va pas sonder pour lui un port qu'il ne
   * loue pas.
   */
  ports: readonly number[];
}

export interface ProbePlan {
  protocol: GameQueryProtocol;
  /** Port interrogé : celui du jeu, ou son port de requête. */
  port: number;
}

interface GameRule {
  game: string;
  protocol: GameQueryProtocol;
  pattern: RegExp;
  /** Décalage du port de requête sur le port principal, faute de variable. */
  offset?: number;
  /**
   * Le port de requête est sans rapport avec le port de jeu (ARK : 27015 pour
   * 7777) : sans la variable, on ne devine pas — on ne sonde pas.
   */
  requiresVariable?: boolean;
}

/**
 * Les jeux reconnus hors Minecraft, par mots entiers : `detectRuntime` cherche
 * des sous-chaînes (« rust » dans « trusted »), ce qui suffit à choisir un
 * catalogue d'extensions mais ferait sonder un serveur dans la mauvaise
 * langue. L'ordre compte : FiveM avant les jeux Steam, dont certains mots
 * pourraient traîner dans un nom de ressource.
 *
 * Aucune règle sur l'image `games:source` seule : Pterodactyl l'emploie pour
 * quantité de jeux SteamCMD qui ne répondent pas à A2S (Satisfactory,
 * Palworld…), et les sonder ferait des pannes imaginaires.
 */
export const GAME_RULES: readonly GameRule[] = [
  { game: "fivem", protocol: "cfx", pattern: /\b(fivem|redm|fxserver|cfx)\b/ },
  // Valheim répond à la requête Steam sur le port de jeu + 1.
  { game: "valheim", protocol: "a2s", pattern: /\bvalheim/, offset: 1 },
  {
    game: "rust",
    protocol: "a2s",
    pattern: /\brust\b|rustdedicated|\boxide\b|\bcarbon\b|\bumod\b/,
  },
  {
    game: "ark",
    protocol: "a2s",
    pattern: /\bark\b|shootergame/,
    requiresVariable: true,
  },
  { game: "7dtd", protocol: "a2s", pattern: /7 ?days|7dtd/ },
  {
    game: "source",
    protocol: "a2s",
    pattern:
      /\bsrcds|source engine|counter[- ]?strike|\bcs2\b|\bcsgo\b|\bcs:go\b|garry|\bgmod\b|team fortress|\btf2\b|left 4 dead|\bl4d2?\b|insurgency|day of defeat/,
  },
];

/**
 * Variables où les eggs Pterodactyl courants rangent le port de requête
 * Steam (ARK, Rust, Arma, Conan…), par ordre de préférence.
 */
export const QUERY_PORT_VARIABLES = [
  "QUERY_PORT",
  "STEAM_QUERY_PORT",
  "SERVER_QUERY_PORT",
  "QUERYPORT",
] as const;

/**
 * Serveurs Minecraft Bedrock (RakNet, en UDP) : le Server List Ping de Java,
 * en TCP, n'y aboutit jamais. Les sonder ainsi les disait en panne chaque
 * minute ; faute de protocole, ils ne sont pas sondés.
 */
const BEDROCK = /bedrock|pocketmine|nukkit/;

export function probePlan(input: ProbePlanInput): ProbePlan | null {
  const declared = readGameQuery(input.declared);
  if (declared) {
    const fromVariable = declared.port_variable
      ? allocatedPort(input, input.variables[declared.port_variable])
      : null;
    return plan(declared.protocol, fromVariable ?? input.port + (declared.port_offset ?? 0));
  }

  const haystack =
    `${input.eggName} ${input.nestName} ${input.image} ${input.startup}`.toLowerCase();
  const runtime = detectRuntime(input.eggName, input.nestName, {});

  if (runtime?.game === "minecraft") {
    return BEDROCK.test(haystack) ? null : plan("minecraft", input.port);
  }

  const rule = GAME_RULES.find((candidate) => candidate.pattern.test(haystack));
  if (!rule) return null;

  // Le port de requête n'a de sens que pour A2S : FiveM sert ses documents
  // sur le port même du jeu.
  const fromVariable =
    rule.protocol === "a2s"
      ? (QUERY_PORT_VARIABLES.map((name) => allocatedPort(input, input.variables[name])).find(
          (port) => port !== null,
        ) ?? null)
      : null;
  if (fromVariable !== null) return plan(rule.protocol, fromVariable);
  if (rule.requiresVariable) return null;
  return plan(rule.protocol, input.port + (rule.offset ?? 0));
}

/** Un port lu dans une variable, retenu seulement s'il est alloué au serveur. */
function allocatedPort(input: ProbePlanInput, value: string | undefined): number | null {
  const port = portOf(value);
  return port !== null && input.ports.includes(port) ? port : null;
}

/** Un port lu dans une variable : entier décimal de 1 à 65535, sinon `null`. */
function portOf(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? "";
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const port = Number(trimmed);
  return port >= 1 && port <= 65_535 ? port : null;
}

function plan(protocol: GameQueryProtocol, port: number): ProbePlan | null {
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? { protocol, port } : null;
}
