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
  variables: ParsedEggVariable[];
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
    variables: readVariables(raw.variables),
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
