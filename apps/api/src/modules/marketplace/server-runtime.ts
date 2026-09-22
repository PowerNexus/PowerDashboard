import type { GameKey, ProjectLoader, ServerRuntime } from "@gamedashboard/contracts";

/**
 * Ce qu'un serveur exécute réellement, déduit de son egg.
 *
 * Le panel n'a pas de colonne « chargeur » : les eggs viennent de Pterodactyl,
 * qui n'en déclare pas. On le déduit donc du nom de l'egg et de son nest, ce
 * qui est une **heuristique** — et elle est traitée comme telle : quand elle
 * ne conclut pas, elle renvoie `null` et l'écran dit qu'il ne sait pas, au
 * lieu de proposer des extensions qui ne démarreraient pas.
 *
 * Le jour où les eggs porteront cette information, ce fichier disparaîtra.
 */

interface LoaderRule {
  loader: ProjectLoader;
  game: GameKey;
  /** Mots reconnus dans le nom de l'egg, en minuscules. */
  keywords: string[];
  /**
   * Dossier où déposer une extension, relatif à la racine du serveur.
   *
   * Se tromper ici ne produit aucune erreur : le fichier est écrit, le jeu ne
   * le lit pas, et l'extension paraît simplement sans effet.
   */
  directory: string;
  /** Variables d'egg où chercher la version du jeu, par ordre de préférence. */
  versionVariables: string[];
}

/**
 * L'ordre compte : « paper » doit être reconnu avant « spigot », car un egg
 * nommé « Paper (Spigot compatible) » est un Paper. De même, « velocity »
 * avant « paper » — un proxy n'accepte pas les plugins d'un serveur de jeu.
 */
const RULES: LoaderRule[] = [
  {
    loader: "velocity",
    game: "minecraft",
    keywords: ["velocity"],
    directory: "plugins",
    versionVariables: ["MINECRAFT_VERSION", "VELOCITY_VERSION"],
  },
  {
    loader: "fabric",
    game: "minecraft",
    keywords: ["fabric"],
    directory: "mods",
    versionVariables: ["MINECRAFT_VERSION", "MC_VERSION"],
  },
  {
    loader: "forge",
    game: "minecraft",
    keywords: ["forge"],
    directory: "mods",
    versionVariables: ["MINECRAFT_VERSION", "MC_VERSION"],
  },
  {
    loader: "paper",
    game: "minecraft",
    keywords: ["paper", "purpur", "pufferfish"],
    directory: "plugins",
    versionVariables: ["MINECRAFT_VERSION", "MC_VERSION"],
  },
  {
    loader: "spigot",
    game: "minecraft",
    keywords: ["spigot", "bukkit", "craftbukkit"],
    directory: "plugins",
    versionVariables: ["MINECRAFT_VERSION", "MC_VERSION"],
  },
  {
    loader: "carbon",
    game: "rust",
    keywords: ["carbon"],
    directory: "carbon/plugins",
    // Rust force une mise à jour mensuelle et les plugins suivent : épingler
    // une version rendrait le catalogue vide onze mois sur douze.
    versionVariables: [],
  },
  {
    loader: "oxide",
    game: "rust",
    keywords: ["oxide", "umod", "rust"],
    directory: "oxide/plugins",
    versionVariables: [],
  },
  {
    /*
     * Le serveur officiel, reconnu en **dernier** parmi les Minecraft.
     *
     * Il n'avait aucune règle : un egg « Vanilla » ne correspondait à rien,
     * `detectRuntime` rendait `null`, et l'écran « Moteur » restait vide — sur
     * le seul serveur qui a le plus de raisons d'en changer, puisqu'il
     * n'accepte ni plugin ni mod.
     *
     * Placé en **dernier** parce que ses mots sont les plus génériques, et
     * pas seulement au sein de Minecraft : « vanilla » qualifie aussi un
     * serveur Rust sans greffon. Posé plus haut, il volait sa famille à Paper
     * comme à Fabric — et « Serveur vanilla » sur un nest « Rust » devenait un
     * serveur Minecraft, ce qu'un test existant a refusé sur-le-champ.
     *
     * `any` plutôt qu'un chargeur : Vanilla n'en a pas. Le catalogue
     * d'extensions ne lui proposera donc rien, ce qui est exact.
     */
    loader: "any",
    game: "minecraft",
    keywords: ["vanilla", "minecraft", "mojang"],
    // Aucun répertoire d'extensions : il n'en charge aucune.
    directory: "mods",
    versionVariables: ["MINECRAFT_VERSION", "MC_VERSION", "VERSION"],
  },
];

export interface DetectedRuntime extends ServerRuntime {
  directory: string;
}

/**
 * Déduit le runtime, ou `null` quand rien ne correspond.
 *
 * `null` est un résultat légitime — un egg de FiveM ou un jeu sans catalogue —
 * et non une erreur : l'appelant l'affiche comme « aucun catalogue pour ce
 * serveur », ce qui est exact.
 */
export function detectRuntime(
  eggName: string,
  nestName: string,
  variables: Record<string, string>,
): DetectedRuntime | null {
  /*
   * La variable d'abord : un egg qui déclare son chargeur sait mieux que son
   * nom ce qu'il fait tourner.
   *
   * **Y compris quand il déclare un chargeur sans catalogue.** `vanilla`
   * n'accepte ni plugin ni mod : la bonne réponse est « aucun catalogue », et
   * retomber sur le nom la contredirait — un egg nommé « Minecraft Java »
   * contient le mot « minecraft », et se verrait proposer des plugins que le
   * serveur ne chargerait jamais. Seule une valeur *inconnue* laisse la main
   * au nom.
   */
  const declare = depuisLaVariable(variables);
  if (declare !== "non-declare") return declare;

  const haystack = `${eggName} ${nestName}`.toLowerCase();
  const rule = RULES.find((candidate) => candidate.keywords.some((k) => haystack.includes(k)));
  if (!rule) return null;

  return {
    game: rule.game,
    loader: rule.loader,
    gameVersion: pickVersion(rule.versionVariables, variables),
    directory: rule.directory,
  };
}

/**
 * Ce que l'egg **déclare**, quand il le déclare.
 *
 * C'est le cas que l'en-tête de ce fichier appelait de ses vœux : « le jour où
 * les eggs porteront cette information ». L'egg « Minecraft Java » du panel le
 * fait — il couvre neuf chargeurs sous un seul nom, précisément pour qu'on en
 * change sans changer d'egg. Deviner son chargeur d'après son nom est alors
 * impossible : il n'en nomme aucun, et devrait tous les nommer.
 *
 * La valeur est celle que voit l'installation, donc celle qui tourne. Elle
 * l'emporte sur le nom, et pas seulement pour cet egg : un egg tiers qui
 * déclarerait `LOADER` en profiterait aussi, sans que personne ait à ajouter
 * son nom à la liste des mots-clés.
 */
function depuisLaVariable(
  variables: Record<string, string>,
): DetectedRuntime | null | "non-declare" {
  const brut = variables.LOADER?.trim().toLowerCase();
  if (!brut) return "non-declare";

  // Déclaré, et sans catalogue : c'est une réponse, pas une absence de
  // réponse. Voir `SANS_CATALOGUE`.
  if (SANS_CATALOGUE.has(brut)) return null;

  const connu = CHARGEURS[brut];
  // Une valeur que nous ne connaissons pas — un chargeur tiers, une faute de
  // frappe : là, le nom de l'egg reste le meilleur indice dont on dispose.
  if (!connu) return "non-declare";

  return {
    game: "minecraft",
    loader: connu.loader,
    gameVersion: pickVersion(["MINECRAFT_VERSION", "MC_VERSION"], variables),
    directory: connu.directory,
  };
}

/**
 * Les chargeurs déclarables qui n'acceptent **rien**.
 *
 * Un serveur sans chargeur ne lit ni plugin ni mod. Lui proposer un catalogue
 * reviendrait à lui promettre des extensions qui ne se chargeraient jamais —
 * et l'écran « Marketplace » n'aurait aucun moyen de le dire après coup.
 *
 * Ils sont listés plutôt qu'omis pour que la déclaration de l'egg l'emporte :
 * omis, ils retomberaient sur la détection par le nom, qui dirait le contraire.
 */
const SANS_CATALOGUE = new Set(["vanilla", "snapshot"]);

/**
 * Les chargeurs qu'une variable peut nommer, et où déposer une extension.
 *
 * `neoforge` et `quilt` retombent sur `forge` et `fabric` : ce sont les
 * chargeurs que les catalogues connaissent, et une recherche sous un nom
 * qu'aucun dépôt n'emploie rendrait une liste vide sans raison visible. C'est
 * un pis-aller assumé — la plupart des mods NeoForge sont publiés sous
 * l'étiquette Forge, et réciproquement pour Quilt et Fabric.
 *
 * `vanilla` est **absent** à dessein : un serveur sans chargeur n'accepte ni
 * plugin ni mod, et lui proposer un catalogue reviendrait à lui promettre des
 * extensions qui ne se chargeraient jamais. L'écran dit alors « aucun
 * catalogue », ce qui est exact.
 */
const CHARGEURS: Record<string, { loader: ProjectLoader; directory: string }> = {
  paper: { loader: "paper", directory: "plugins" },
  purpur: { loader: "paper", directory: "plugins" },
  folia: { loader: "paper", directory: "plugins" },
  spigot: { loader: "spigot", directory: "plugins" },
  velocity: { loader: "velocity", directory: "plugins" },
  fabric: { loader: "fabric", directory: "mods" },
  quilt: { loader: "fabric", directory: "mods" },
  forge: { loader: "forge", directory: "mods" },
  neoforge: { loader: "forge", directory: "mods" },
};

/**
 * Première variable renseignée parmi celles attendues.
 *
 * `latest` est traité comme « pas de version épinglée » : c'est une valeur
 * courante dans les eggs, et la comparer aux versions de jeu d'un catalogue
 * ne donnerait jamais de correspondance — donc un catalogue vide sans raison
 * visible.
 */
function pickVersion(candidates: string[], variables: Record<string, string>): string {
  for (const name of candidates) {
    const value = variables[name]?.trim();
    if (value && value !== "" && value.toLowerCase() !== "latest") return value;
  }
  return "";
}
