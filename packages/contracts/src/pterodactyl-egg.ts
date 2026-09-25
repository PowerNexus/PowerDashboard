/**
 * Lecture d'un export d'egg Pterodactyl.
 *
 * Le format est celui produit par « Export » dans Pterodactyl et publié tel
 * quel dans `pterodactyl/game-eggs`. Il est lu ici, jamais réécrit : Wings
 * étant inchangé, c'est lui qui impose la forme de ce qu'on lui servira
 * ensuite.
 *
 * Ce module ne fait que **traduire et refuser**. Il ne touche ni au réseau ni à
 * la base : un fichier d'egg est une donnée venue d'ailleurs, et ce qui décide
 * de ce qu'on en accepte doit pouvoir être éprouvé sans les deux.
 */

import { type PlayerCommands, readPlayerCommands } from "./player-commands";

/** Versions du format qu'on sait lire. */
export const SUPPORTED_EGG_VERSIONS = ["PTDL_v1", "PTDL_v2"] as const;
export type SupportedEggVersion = (typeof SUPPORTED_EGG_VERSIONS)[number];

export interface ParsedEggVariable {
  name: string;
  envVariable: string;
  description: string | null;
  defaultValue: string;
  userViewable: boolean;
  userEditable: boolean;
  rules: string;
}

export interface ParsedEgg {
  name: string;
  description: string | null;
  author: string | null;
  /** Images Docker, sous la forme `{ "libellé": "image:tag" }` du format v2. */
  dockerImages: Record<string, string>;
  startup: string;
  configFiles: unknown;
  configStartup: unknown;
  configStop: string | null;
  configLogs: unknown;
  installScript: string;
  installContainer: string;
  installEntrypoint: string;
  features: string[];
  fileDenylist: string[];
  /** Commandes du jeu proposées à la console (`say <message>`). */
  consoleCommands: string[];
  variables: ParsedEggVariable[];
  /** Extension propre à GameDashboard : commandes de la vue joueurs (`player_commands`). */
  playerCommands: PlayerCommands;
}

/** Ce qu'on reproche à un fichier, dit de façon à pouvoir le corriger. */
export class EggParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EggParseError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Les images Docker ont changé de forme entre v1 et v2.
 *
 * v1 porte un `docker_image` unique ; v2 porte un objet `docker_images` dont
 * les clés sont des libellés lisibles. On ramène le premier cas au second
 * plutôt que de traîner deux formes jusqu'à la base : l'egg est servi à Wings,
 * qui n'en connaît qu'une.
 */
function readDockerImages(raw: Record<string, unknown>): Record<string, string> {
  const images = asRecord(raw.docker_images);
  if (images) {
    const entries = Object.entries(images).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    if (entries.length > 0) return Object.fromEntries(entries);
  }

  const single = asString(raw.docker_image);
  if (single) return { [single]: single };

  throw new EggParseError("Aucune image Docker : l'egg ne pourrait rien démarrer.");
}

function readVariables(raw: unknown): ParsedEggVariable[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const variables: ParsedEggVariable[] = [];

  for (const entry of raw) {
    const variable = asRecord(entry);
    if (!variable) continue;

    const envVariable = asString(variable.env_variable)?.trim();
    if (!envVariable) continue;

    /*
     * Deux variables de même nom d'environnement ne peuvent pas coexister :
     * l'une écraserait l'autre au démarrage du conteneur, et la base porte de
     * toute façon une contrainte d'unicité. On garde la première et on ignore
     * la suivante, plutôt que de refuser l'egg entier pour un doublon que son
     * auteur n'a sans doute pas vu.
     */
    if (seen.has(envVariable)) continue;
    seen.add(envVariable);

    variables.push({
      name: asString(variable.name)?.trim() || envVariable,
      envVariable,
      description: asString(variable.description)?.trim() || null,
      // `default_value` peut être un nombre dans certains eggs publiés.
      defaultValue: String(variable.default_value ?? ""),
      // Absent vaut visible : c'est le défaut de Pterodactyl, et masquer une
      // variable que l'auteur voulait montrer casserait la configuration.
      userViewable: variable.user_viewable !== false,
      // Absent vaut **non** éditable : l'inverse ouvrirait à l'écriture des
      // champs dont personne n'a décidé qu'ils l'étaient.
      userEditable: variable.user_editable === true,
      rules: asString(variable.rules)?.trim() || "required|string",
    });
  }

  return variables;
}

/**
 * Traduit un export d'egg.
 *
 * Refuse plutôt que de compléter : un egg auquel il manque sa commande de
 * démarrage ou son conteneur d'installation ne produirait pas un serveur
 * dégradé, il produirait un serveur qui échoue à l'installation sans qu'on
 * sache pourquoi.
 */
export function parsePterodactylEgg(input: unknown): ParsedEgg {
  const raw = asRecord(input);
  if (!raw) throw new EggParseError("Ce n'est pas un objet JSON.");

  const meta = asRecord(raw.meta);
  const version = asString(meta?.version);
  if (version && !SUPPORTED_EGG_VERSIONS.includes(version as SupportedEggVersion)) {
    throw new EggParseError(
      `Format d'egg inconnu : « ${version} ». Attendu : ${SUPPORTED_EGG_VERSIONS.join(" ou ")}.`,
    );
  }

  const name = asString(raw.name)?.trim();
  if (!name) throw new EggParseError("L'egg n'a pas de nom.");

  const startup = asString(raw.startup)?.trim();
  if (!startup) throw new EggParseError(`« ${name} » n'a pas de commande de démarrage.`);

  const scripts = asRecord(raw.scripts);
  const installation = asRecord(asRecord(scripts?.installation) ?? {});
  const installContainer = asString(installation?.container)?.trim();
  if (!installContainer) {
    throw new EggParseError(`« ${name} » n'a pas de conteneur d'installation.`);
  }

  return {
    name,
    description: asString(raw.description)?.trim() || null,
    author: asString(raw.author)?.trim() || null,
    dockerImages: readDockerImages(raw),
    startup,
    configFiles: parseMaybeJson(raw.config && asRecord(raw.config)?.files) ?? {},
    configStartup: parseMaybeJson(raw.config && asRecord(raw.config)?.startup) ?? {},
    configStop: asString(asRecord(raw.config)?.stop)?.trim() || null,
    configLogs: parseMaybeJson(raw.config && asRecord(raw.config)?.logs) ?? {},
    installScript: asString(installation?.script) ?? "",
    installContainer,
    installEntrypoint: asString(installation?.entrypoint)?.trim() || "bash",
    features: readStringArray(raw.features),
    fileDenylist: readStringArray(raw.file_denylist),
    // Extension de GameDashboard : Pterodactyl ignore la clé à l'import, et
    // un egg venu de chez lui arrive donc sans commande proposée.
    consoleCommands: readStringArray(raw.console_commands),
    variables: readVariables(raw.variables),
    playerCommands: readPlayerCommands(raw.player_commands),
  };
}

/**
 * Les blocs de configuration sont parfois des objets, parfois des chaînes.
 *
 * Pterodactyl les sérialise en JSON dans certains exports et les laisse en
 * objet dans d'autres. Stocker les deux formes telles quelles obligerait
 * chaque lecteur à refaire ce test — y compris la route qui sert Wings, où une
 * chaîne au lieu d'un objet passerait sans erreur et donnerait un serveur muet.
 */
function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    // Une chaîne qui n'est pas du JSON n'est pas un bloc de configuration :
    // on préfère un bloc vide à une valeur dont on ne sait rien.
    return {};
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Export d'un egg au format PTDL_v2, tel que Pterodactyl le produit.
 *
 * Le fichier doit pouvoir **revenir** : réimporté ici, il redonne le même egg
 * (`parsePterodactylEgg(exportPterodactylEgg(egg))` égale `egg`) ; importé
 * dans un Pterodactyl, il y est lu comme l'un des siens. Les deux lecteurs
 * n'attendent pas tout à fait la même chose, et c'est Pterodactyl qui dicte
 * la forme :
 *
 * - les blocs `config.*` sont des **chaînes JSON**, pas des objets. Le lecteur
 *   d'ici accepte les deux, celui de Pterodactyl n'accepte que la chaîne ;
 * - `field_type` est posé sur chaque variable : PTDL_v2 l'a introduit, et un
 *   Pterodactyl récent l'attend.
 */
export interface PterodactylEggExport {
  _comment: string;
  meta: { version: "PTDL_v2"; update_url: null };
  exported_at: string;
  name: string;
  author: string;
  description: string | null;
  features: string[];
  docker_images: Record<string, string>;
  file_denylist: string[];
  /** Extension de GameDashboard, ignorée par Pterodactyl (voir `parsePterodactylEgg`). */
  console_commands: string[];
  startup: string;
  config: { files: string; startup: string; logs: string; stop: string | null };
  scripts: { installation: { script: string; container: string; entrypoint: string } };
  variables: {
    name: string;
    description: string;
    env_variable: string;
    default_value: string;
    user_viewable: boolean;
    user_editable: boolean;
    rules: string;
    field_type: "text";
  }[];
  /**
   * Clé propre à GameDashboard, absente quand l'egg n'en déclare pas.
   * Pterodactyl ignore les clés qu'il ne connaît pas : l'export reste lisible.
   */
  player_commands?: PlayerCommands;
}

/**
 * `exportedAt` est un paramètre plutôt qu'une lecture de l'horloge : c'est la
 * seule valeur qui change d'un export à l'autre, et un test qui compare deux
 * exports ne doit pas dépendre de la seconde où il tourne.
 */
export function exportPterodactylEgg(
  egg: ParsedEgg,
  exportedAt: Date = new Date(),
): PterodactylEggExport {
  return {
    _comment: "Export GameDashboard au format Pterodactyl PTDL_v2.",
    meta: { version: "PTDL_v2", update_url: null },
    // Pterodactyl écrit l'instant avec son décalage (`+00:00`), pas le `Z`
    // d'ISO : on s'y conforme, certains outils tiers comparent la chaîne.
    exported_at: exportedAt.toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    name: egg.name,
    // Chaîne vide et non `null` : Pterodactyl exige le champ, et notre lecteur
    // ramène la chaîne vide à `null` — l'aller-retour reste exact.
    author: egg.author ?? "",
    description: egg.description,
    features: [...egg.features],
    docker_images: { ...egg.dockerImages },
    file_denylist: [...egg.fileDenylist],
    console_commands: [...egg.consoleCommands],
    startup: egg.startup,
    config: {
      files: configBlock(egg.configFiles),
      startup: configBlock(egg.configStartup),
      logs: configBlock(egg.configLogs),
      stop: egg.configStop,
    },
    scripts: {
      installation: {
        script: egg.installScript,
        container: egg.installContainer,
        entrypoint: egg.installEntrypoint,
      },
    },
    variables: egg.variables.map((variable) => ({
      name: variable.name,
      // Même raison que pour l'auteur : chaîne vide exportée, `null` relu.
      description: variable.description ?? "",
      env_variable: variable.envVariable,
      default_value: variable.defaultValue,
      user_viewable: variable.userViewable,
      user_editable: variable.userEditable,
      rules: variable.rules,
      field_type: "text",
    })),
    ...(Object.keys(egg.playerCommands).length > 0
      ? { player_commands: { ...egg.playerCommands } }
      : {}),
  };
}

/**
 * Un bloc de configuration, sérialisé comme Pterodactyl l'attend.
 *
 * Indenté sur quatre espaces, comme ses propres exports : un bloc de trois
 * kilo-octets sur une seule ligne ne se relit pas. `null` devient `{}` — le
 * lecteur ferait de même, et Pterodactyl refuse une chaîne vide.
 */
function configBlock(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 4);
}
