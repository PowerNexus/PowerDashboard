/**
 * Vue joueurs : actions de modération par commandes d'egg déclaratives.
 *
 * Le panel ne parle pas au jeu : il n'a que la console, par Wings. Expulser ou
 * bannir un joueur revient donc à taper la bonne commande — et la bonne
 * commande dépend du jeu. Plutôt que de coder chaque jeu en dur, l'egg les
 * **déclare** dans une clé propre à GameDashboard, `player_commands`, que
 * Pterodactyl ignore à l'import et que Wings ne voit jamais :
 *
 * ```json
 * "player_commands": { "kick": "kick {player} {reason}", "ban": "ban {player}" }
 * ```
 *
 * Tout ce qui entre dans une commande passe par ici. Un nom de joueur qui
 * contiendrait une espace ou un saut de ligne ferait **deux** commandes : c'est
 * la porte d'une élévation (`x\nop x`), d'où la liste blanche stricte de
 * caractères, sans exception.
 */

/** Actions proposées, dans l'ordre d'affichage. */
export const PLAYER_ACTIONS = [
  "kick",
  "ban",
  "pardon",
  "whitelist_add",
  "whitelist_remove",
  "op",
  "deop",
] as const;
export type PlayerAction = (typeof PLAYER_ACTIONS)[number];

export function isPlayerAction(value: unknown): value is PlayerAction {
  return typeof value === "string" && (PLAYER_ACTIONS as readonly string[]).includes(value);
}

/** Commandes déclarées par un egg, action par action. Une action absente n'est pas proposée. */
export type PlayerCommands = Partial<Record<PlayerAction, string>>;

/**
 * Actions qui donnent ou retirent des droits dans le jeu. Elles exigent en plus
 * `console.send` : un opérateur peut tout taper, c'est la console par un détour.
 */
export const PRIVILEGED_PLAYER_ACTIONS: readonly PlayerAction[] = ["op", "deop"];

/** Longueur maximale d'un modèle de commande : au-delà, ce n'est plus une commande de modération. */
export const PLAYER_COMMAND_MAX_LENGTH = 200;

/** Longueur maximale d'un motif, recopié dans la commande. */
export const PLAYER_REASON_MAX_LENGTH = 100;

/**
 * Nom de joueur admissible dans une commande.
 *
 * Plus large que Minecraft Java (`[A-Za-z0-9_]{3,16}`) pour couvrir Bedrock par
 * Floodgate (préfixe `.`) et d'autres jeux, mais sans espace, guillemet ni
 * caractère de contrôle : rien qui puisse couper ou prolonger une commande.
 */
const PLAYER_NAME = /^[A-Za-z0-9_.-]{1,32}$/;

export function isPlayerName(value: unknown): value is string {
  return typeof value === "string" && PLAYER_NAME.test(value);
}

/**
 * Commandes par défaut d'un serveur Minecraft Java.
 *
 * Servent quand l'egg n'en déclare pas : les installations existantes gardent
 * leur egg Minecraft tel qu'importé, et la vue joueurs ne doit pas attendre
 * une resynchronisation pour fonctionner. Ce sont les commandes vanilla,
 * reprises à l'identique par Paper, Spigot, Fabric et Forge.
 */
export const MINECRAFT_PLAYER_COMMANDS: PlayerCommands = {
  kick: "kick {player} {reason}",
  ban: "ban {player} {reason}",
  pardon: "pardon {player}",
  whitelist_add: "whitelist add {player}",
  whitelist_remove: "whitelist remove {player}",
  op: "op {player}",
  deop: "deop {player}",
};

/**
 * Lit la clé `player_commands` d'un egg.
 *
 * Une entrée douteuse est **écartée**, pas corrigée : action inconnue, modèle
 * sans `{player}`, saut de ligne, modèle trop long. Refuser l'egg entier pour
 * une ligne mal écrite priverait son auteur de tout le reste.
 */
export function readPlayerCommands(raw: unknown): PlayerCommands {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};

  const commands: PlayerCommands = {};
  for (const action of PLAYER_ACTIONS) {
    const template = (raw as Record<string, unknown>)[action];
    if (typeof template !== "string") continue;
    const trimmed = template.trim();
    if (!isPlayerCommandTemplate(trimmed)) continue;
    commands[action] = trimmed;
  }
  return commands;
}

/** Un modèle porte `{player}`, tient sur une ligne et reste court. */
export function isPlayerCommandTemplate(template: string): boolean {
  return (
    template.length > 0 &&
    template.length <= PLAYER_COMMAND_MAX_LENGTH &&
    template.includes("{player}") &&
    // biome-ignore lint/suspicious/noControlCharactersInRegex: c'est précisément ce qu'on refuse.
    !/[\u0000-\u001f\u007f]/.test(template)
  );
}

/**
 * Motif nettoyé : caractères de contrôle retirés, blancs ramenés à une espace,
 * longueur bornée. Un motif ne peut donc jamais ajouter de ligne à la console.
 */
export function cleanPlayerReason(reason: unknown): string {
  if (typeof reason !== "string") return "";
  return (
    reason
      // biome-ignore lint/suspicious/noControlCharactersInRegex: on les retire.
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, PLAYER_REASON_MAX_LENGTH)
      .trim()
  );
}

/**
 * Commande prête à partir, ou `null` si le nom n'est pas admissible.
 *
 * Sans motif, `{reason}` disparaît avec l'espace qui le précède : « kick Steve »
 * et non « kick Steve  ».
 */
export function renderPlayerCommand(
  template: string,
  player: string,
  reason?: string,
): string | null {
  if (!isPlayerName(player) || !isPlayerCommandTemplate(template)) return null;
  const cleaned = cleanPlayerReason(reason);
  return template
    .replaceAll("{player}", player)
    .replaceAll("{reason}", cleaned)
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * Commandes effectives d'un serveur : celles de l'egg, sinon celles du jeu
 * reconnu. Un egg qui en déclare ne se mélange pas aux défauts : son auteur a
 * choisi ce qu'il proposait.
 */
export function effectivePlayerCommands(
  declared: PlayerCommands | null | undefined,
  game: string | null,
): PlayerCommands {
  if (declared && Object.keys(declared).length > 0) return declared;
  return game === "minecraft" ? MINECRAFT_PLAYER_COMMANDS : {};
}
