import { z } from "zod";
import { compareVersions } from "./version";

export const MarketplaceSource = z.enum(["modrinth", "curseforge", "spigot", "custom"]);
export type MarketplaceSource = z.infer<typeof MarketplaceSource>;

export const MARKETPLACE_SOURCE_LABEL: Record<MarketplaceSource, string> = {
  modrinth: "Modrinth",
  curseforge: "CurseForge",
  spigot: "SpigotMC",
  custom: "Dépôt interne",
};

/** Jeux dont le panel sait peupler un catalogue. */
export const GameKey = z.enum(["minecraft", "rust", "ark", "seven-days-to-die", "fivem"]);
export type GameKey = z.infer<typeof GameKey>;

export const GAME_LABEL: Record<GameKey, string> = {
  minecraft: "Minecraft",
  rust: "Rust",
  ark: "ARK: Survival Evolved",
  "seven-days-to-die": "7 Days to Die",
  fivem: "FiveM",
};

/**
 * Sources interrogeables par jeu. Un tableau vide signifie qu'aucun catalogue
 * public n'existe : mieux vaut le dire que de renvoyer une liste vide sans
 * expliquer pourquoi. FiveM distribue ses ressources hors de tout registre.
 */
export const GAME_SOURCES: Record<GameKey, MarketplaceSource[]> = {
  minecraft: ["modrinth", "curseforge"],
  rust: ["curseforge"],
  ark: ["curseforge"],
  "seven-days-to-die": ["curseforge"],
  fivem: [],
};

/**
 * Chargeur ou cadre d'extension attendu par une publication.
 * Minecraft distingue Paper, Fabric et Forge ; Rust oppose Oxide à Carbon.
 */
export const ProjectLoader = z.enum([
  "paper",
  "spigot",
  "fabric",
  "forge",
  "velocity",
  "oxide",
  "carbon",
  "any",
]);
export type ProjectLoader = z.infer<typeof ProjectLoader>;

export const ProjectRelease = z.object({
  version: z.string(),
  /** Versions de jeu prises en charge par cette publication. */
  gameVersions: z.array(z.string()).min(1),
  loaders: z.array(ProjectLoader).min(1),
  publishedAt: z.string().datetime(),
  /**
   * Adresse du fichier à déposer dans le conteneur.
   *
   * `null` est un cas réel, pas une anomalie : sur CurseForge, un auteur peut
   * interdire la distribution par des tiers, et l'API renvoie alors une URL
   * vide. Il faut le dire à l'utilisateur plutôt que proposer une installation
   * qui échouerait.
   */
  downloadUrl: z.string().url().nullable(),
  /** Nom du fichier tel qu'il sera posé, pour pouvoir le retirer ensuite. */
  fileName: z.string(),
});
export type ProjectRelease = z.infer<typeof ProjectRelease>;

/** Vrai si la publication peut réellement être installée par le panel. */
export function isInstallable(release: ProjectRelease): boolean {
  return release.downloadUrl !== null;
}

export const MarketplaceProject = z.object({
  id: z.string(),
  source: MarketplaceSource,
  name: z.string(),
  summary: z.string(),
  author: z.string(),
  downloads: z.number().int().nonnegative(),
  categories: z.array(z.string()),
  releases: z.array(ProjectRelease).min(1),
});
export type MarketplaceProject = z.infer<typeof MarketplaceProject>;

export const InstalledAddon = z.object({
  projectId: z.string(),
  version: z.string(),
  installedAt: z.string().datetime(),
  /** Fichier posé dans le conteneur, pour pouvoir le retirer proprement. */
  fileName: z.string(),
});
export type InstalledAddon = z.infer<typeof InstalledAddon>;

/** Contexte du serveur : ce qui décide de la compatibilité d'une publication. */
export interface ServerRuntime {
  game: GameKey;
  loader: ProjectLoader;
  /**
   * Version de jeu à respecter. Vide pour les jeux que leurs extensions ne
   * suivent pas version par version : Rust publie une mise à jour forcée
   * chaque mois et les plugins Oxide sont conçus pour suivre automatiquement.
   */
  gameVersion: string;
}

/**
 * Une publication convient si elle vise le chargeur du serveur et, lorsque le
 * jeu l'impose, sa version. `any` couvre les projets indépendants du chargeur
 * (packs de ressources, scripts de configuration).
 */
export function isReleaseCompatible(release: ProjectRelease, runtime: ServerRuntime): boolean {
  const loaderOk =
    release.loaders.includes("any") ||
    release.loaders.includes(runtime.loader) ||
    // Un plugin Spigot fonctionne sur Paper, qui en est un dérivé. L'inverse est faux.
    (runtime.loader === "paper" && release.loaders.includes("spigot"));
  if (!loaderOk) return false;

  // Sans version épinglée, le chargeur suffit à décider.
  if (runtime.gameVersion === "") return true;
  return release.gameVersions.includes(runtime.gameVersion);
}

/** Vrai si un catalogue public existe pour ce jeu. */
export function hasCatalogue(game: GameKey): boolean {
  return GAME_SOURCES[game].length > 0;
}

/**
 * Publication compatible la plus récente, ou `null` si le projet ne convient pas.
 *
 * L'ordre repose sur la date de publication, pas sur la chaîne de version : les
 * catalogues ne s'accordent pas sur le format. CurseForge expose des noms de
 * fichier comme « jei-1.19.2-forge-11.4.0.286.jar », où la version du jeu
 * précède celle du mod et fausserait toute comparaison numérique.
 */
export function latestCompatibleRelease(
  project: MarketplaceProject,
  runtime: ServerRuntime,
): ProjectRelease | null {
  const compatible = project.releases.filter((r) => isReleaseCompatible(r, runtime));
  if (compatible.length === 0) return null;
  return compatible.reduce((best, current) =>
    Date.parse(current.publishedAt) > Date.parse(best.publishedAt) ? current : best,
  );
}

export type AddonState =
  | { kind: "installable"; release: ProjectRelease }
  /** Compatible, mais l'auteur interdit le téléchargement par un tiers. */
  | { kind: "download-blocked"; release: ProjectRelease }
  | { kind: "up-to-date"; installed: string }
  | { kind: "update-available"; installed: string; release: ProjectRelease }
  | { kind: "incompatible" }
  /** Installé, mais plus aucune publication ne convient au runtime actuel. */
  | { kind: "installed-incompatible"; installed: string };

/**
 * État d'un projet pour un serveur donné. Distingue « pas compatible » de
 * « installé mais devenu incompatible » : le second cas survient après une
 * montée de version du jeu et doit être signalé, pas masqué.
 */
export function addonState(
  project: MarketplaceProject,
  runtime: ServerRuntime,
  installed: InstalledAddon | undefined,
): AddonState {
  const release = latestCompatibleRelease(project, runtime);

  if (!installed) {
    if (!release) return { kind: "incompatible" };
    return isInstallable(release)
      ? { kind: "installable", release }
      : { kind: "download-blocked", release };
  }
  if (!release) return { kind: "installed-incompatible", installed: installed.version };

  // Même publication : rien à faire, quel que soit le format du nom.
  if (release.version === installed.version)
    return { kind: "up-to-date", installed: installed.version };

  // Garde-fou contre la rétrogradation : si les deux chaînes se comparent et
  // que l'installée est supérieure, on ne propose pas de revenir en arrière.
  if (compareVersions(release.version, installed.version) <= 0) {
    return { kind: "up-to-date", installed: installed.version };
  }

  return { kind: "update-available", installed: installed.version, release };
}

/**
 * Extrait la version de jeu annoncée par un serveur qui répond.
 *
 * Elle vient du « Server List Ping », où un serveur Minecraft se présente par
 * une chaîne libre : « 1.21.1 », « Paper 1.21.1 », « Waterfall 1.20 », parfois
 * « 1.20.4-1.21 » pour ceux qui acceptent plusieurs versions.
 *
 * **Pourquoi la lire alors que l'egg porte déjà une variable de version ?**
 * Parce que cette variable vaut très souvent « latest », et que le panel
 * refuse alors de deviner — à juste titre. Mais le serveur, lui, sait ce qu'il
 * exécute, et il le dit à chaque sonde. La conséquence de l'ignorer n'est pas
 * neutre : sans version connue, le catalogue d'extensions ne filtre plus que
 * sur le chargeur, et propose un plugin de 1.8 à un serveur en 1.21.
 *
 * La **première** suite de chiffres est retenue : dans « 1.20.4-1.21 », c'est
 * la plus ancienne, donc la plus prudente — une extension compatible avec elle
 * l'est presque toujours avec la suivante, l'inverse étant faux.
 *
 * Rend `""` quand rien ne ressemble à une version : on retombe alors sur le
 * comportement d'avant, qui ne filtre pas. Inventer un numéro ferait
 * disparaître des extensions parfaitement valables.
 */
export function gameVersionFromPing(announced: string | null | undefined): string {
  if (typeof announced !== "string") return "";
  const found = /(\d+\.\d+(?:\.\d+)?)/.exec(announced);
  return found?.[1] ?? "";
}
