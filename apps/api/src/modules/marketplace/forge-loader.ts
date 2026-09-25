import type { PackLoader } from "@gamedashboard/contracts";

/**
 * Forge et NeoForge d'un modpack : ce que le panel résout, et rien d'autre.
 *
 * **Pourquoi par l'egg, et pas par un fichier posé.** Forge et NeoForge ne
 * publient pas de serveur lançable mais un installeur Java, qui doit tourner
 * dans le conteneur pour télécharger ses bibliothèques et fabriquer le serveur
 * (`java -jar … --installServer`). Le panel ne peut rien exécuter dans le
 * conteneur par lui-même ; ce que Wings sait faire, c'est lancer le script
 * d'installation de l'egg dans son image d'installation. L'egg « Minecraft
 * Java » du panel (`infra/eggs/minecraft-java/install.sh`) sait **déjà**
 * poser Forge et NeoForge d'après trois variables — `LOADER`,
 * `LOADER_VERSION`, `MINECRAFT_VERSION` — sans toucher aux mondes, aux mods
 * ni aux configurations. La voie la plus sûre est donc de régler ces
 * variables et de relancer l'installation : aucun script fabriqué à la volée,
 * aucun changement de Wings, et le chargeur est posé exactement comme il le
 * serait par une réinstallation faite à la main.
 *
 * Ce fichier ne fait que des calculs purs, testés sans réseau : le motif
 * strict des versions, les adresses épinglées aux dépôts officiels, la
 * lecture de leurs `maven-metadata.xml`, et les valeurs des variables.
 */

export type ForgeFamily = "forge" | "neoforge";

/** Dépôts officiels. Aucune autre adresse n'est lue ni composée. */
export const FORGE_MAVEN = "https://maven.minecraftforge.net/net/minecraftforge/forge";
export const NEOFORGE_MAVEN = "https://maven.neoforged.net/releases/net/neoforged/neoforge";
/** NeoForge 1.20.1, publié sous l'ancien artefact `forge` de son dépôt. */
export const NEOFORGE_LEGACY_MAVEN = "https://maven.neoforged.net/releases/net/neoforged/forge";

/** Version du jeu : « 1.20.1 », « 1.21 », « 26.1 ». Ni chemin, ni lettre. */
const GAME_VERSION = /^\d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/;
/** Forge : « 47.3.0 », « 14.23.5.2860 », « 10.13.4.1614 ». */
const FORGE_VERSION = /^\d{1,3}(?:\.\d{1,5}){2,3}$/;
/** NeoForge : « 21.1.77 », « 20.4.237 », « 21.0.0-beta », « 47.1.106 » (1.20.1). */
const NEOFORGE_VERSION = /^\d{1,3}(?:\.\d{1,5}){2,3}(?:-beta)?$/;
/** Suffixe des anciennes versions de Forge : « 1.7.10-10.13.4.1614-1.7.10 ». */
const LEGACY_SUFFIX = /^\d{1,2}(?:\.\d{1,2}){1,2}$/;

export interface ForgeRequest {
  family: ForgeFamily;
  /** Version du chargeur, telle que le manifeste du pack la donne. */
  version: string;
  gameVersion: string;
}

/** Ce qui sera installé, résolu contre le dépôt officiel. */
export interface ForgeTarget {
  family: ForgeFamily;
  gameVersion: string;
  /** Valeur de `LOADER_VERSION` : l'egg compose `<jeu>-<valeur>` pour Forge. */
  loaderVersion: string;
  /** L'installeur que le script de l'egg téléchargera, pour le compte rendu et les tests. */
  installerUrl: string;
  /** « Forge 47.3.0 pour Minecraft 1.20.1 ». */
  label: string;
}

/** Nom lisible d'un chargeur de pack. */
export function loaderName(loader: PackLoader): string {
  if (loader === "fabric") return "Fabric Loader";
  if (loader === "neoforge") return "NeoForge";
  if (loader === "quilt") return "Quilt";
  return "Forge";
}

/**
 * Refuse une demande malformée, avant tout appel réseau.
 *
 * Les deux valeurs viennent du manifeste du pack, donc d'un tiers : elles
 * finissent dans une adresse et dans une variable d'environnement du
 * conteneur. Le motif est strict — chiffres et points, rien d'autre —, si
 * bien qu'un « ../ », une barre ou un `$(…)` n'y passent pas. Rend la raison
 * du refus, ou `null`.
 */
export function refusForge(request: ForgeRequest): string | null {
  const name = loaderName(request.family);
  if (request.version === "") {
    return `Le pack ne dit pas quelle version de ${name} il demande : le chargeur n'a pas été posé.`;
  }
  if (!GAME_VERSION.test(request.gameVersion)) {
    return `La version de Minecraft du pack (« ${court(request.gameVersion)} ») est malformée : ${name} n'a pas été posé.`;
  }
  const motif = request.family === "forge" ? FORGE_VERSION : NEOFORGE_VERSION;
  if (!motif.test(request.version)) {
    return `La version de ${name} demandée par le pack (« ${court(request.version)} ») est malformée : le chargeur n'a pas été posé.`;
  }
  // NeoForge numérote d'après le jeu : 1.21.1 donne 21.1.x. Une version qui
  // ne correspond pas trahit un manifeste incohérent, qu'on ne suit pas.
  if (request.family === "neoforge" && request.gameVersion !== "1.20.1") {
    const prefixe = neoforgePrefix(request.gameVersion);
    if (prefixe && !request.version.startsWith(prefixe)) {
      return `NeoForge ${request.version} ne correspond pas à Minecraft ${request.gameVersion} : le chargeur n'a pas été posé.`;
    }
  }
  return null;
}

/** L'index des versions publiées, sur le dépôt officiel qui convient. */
export function metadataUrl(request: Pick<ForgeRequest, "family" | "gameVersion">): string {
  if (request.family === "forge") return `${FORGE_MAVEN}/maven-metadata.xml`;
  return `${request.gameVersion === "1.20.1" ? NEOFORGE_LEGACY_MAVEN : NEOFORGE_MAVEN}/maven-metadata.xml`;
}

/**
 * Les versions d'un `maven-metadata.xml`.
 *
 * Lu par un motif et non par un analyseur XML : seules les balises `<version>`
 * comptent, et toute valeur hors de l'alphabet d'une version est écartée.
 */
export function parseMavenVersions(xml: string): string[] {
  const found: string[] = [];
  for (const match of xml.matchAll(/<version>([^<]{1,64})<\/version>/g)) {
    const value = match[1]?.trim() ?? "";
    if (/^[0-9A-Za-z.+-]+$/.test(value)) found.push(value);
  }
  return found;
}

/**
 * La version à installer, **si le dépôt officiel la publie**.
 *
 * Forge range ses artefacts sous `<jeu>-<version>`, et les plus anciens sous
 * `<jeu>-<version>-<jeu>` (« 1.7.10-10.13.4.1614-1.7.10 ») : le suffixe ne se
 * devine pas, il se lit dans l'index. NeoForge range les siens sous leur seule
 * version, sauf pour 1.20.1 (`1.20.1-47.1.106`, ancien artefact `forge`).
 * `null` : le dépôt ne connaît pas cette version.
 */
export function resolveForgeTarget(request: ForgeRequest, available: string[]): ForgeTarget | null {
  if (refusForge(request) !== null) return null;
  const { family, version, gameVersion } = request;
  const label = `${loaderName(family)} ${version} pour Minecraft ${gameVersion}`;

  if (family === "forge") {
    const exact = `${gameVersion}-${version}`;
    const artifact =
      available.find((entry) => entry === exact) ??
      available.find(
        (entry) =>
          entry.startsWith(`${exact}-`) && LEGACY_SUFFIX.test(entry.slice(exact.length + 1)),
      );
    if (!artifact) return null;
    return {
      family,
      gameVersion,
      loaderVersion: artifact.slice(gameVersion.length + 1),
      installerUrl: `${FORGE_MAVEN}/${artifact}/forge-${artifact}-installer.jar`,
      label,
    };
  }

  if (gameVersion === "1.20.1") {
    const artifact = `1.20.1-${version}`;
    if (!available.includes(artifact)) return null;
    return {
      family,
      gameVersion,
      loaderVersion: version,
      installerUrl: `${NEOFORGE_LEGACY_MAVEN}/${artifact}/forge-${artifact}-installer.jar`,
      label,
    };
  }
  if (!available.includes(version)) return null;
  return {
    family,
    gameVersion,
    loaderVersion: version,
    installerUrl: `${NEOFORGE_MAVEN}/${version}/neoforge-${version}-installer.jar`,
    label,
  };
}

/** Les variables de l'egg « Minecraft Java » qui lui font poser ce chargeur. */
export function eggSettingsFor(target: ForgeTarget): Record<string, string> {
  return {
    LOADER: target.family,
    LOADER_VERSION: target.loaderVersion,
    MINECRAFT_VERSION: target.gameVersion,
  };
}

/** Les variables sans lesquelles l'egg ne sait pas poser le chargeur. */
export const FORGE_EGG_VARIABLES = ["LOADER", "LOADER_VERSION", "MINECRAFT_VERSION"] as const;

/**
 * Le pack retenu en base tient-il toujours, après une réinstallation par l'egg ?
 *
 * Une réinstallation efface d'ordinaire le moteur retenu : le panel ne sait
 * pas ce que le script d'un egg a posé. Mais quand les variables du serveur
 * nomment **exactement** le chargeur que le pack demande, le script de l'egg
 * « Minecraft Java » a reposé ce chargeur-là et n'a touché ni aux mods ni aux
 * configurations : le suivi reste vrai. C'est ce qui arrive quand le panel
 * relance lui-même l'installation pour poser Forge ou NeoForge — sans cette
 * règle, la pose du chargeur effacerait le suivi des fichiers du pack.
 */
export function packLoaderStillInstalled(
  record: { kind: string; loader: string | null; gameVersion: string },
  variables: Record<string, string>,
): boolean {
  if (record.kind !== "pack" || !record.loader) return false;
  const [family = "", version = ""] = record.loader.split(" ");
  if (family !== "forge" && family !== "neoforge") return false;
  if (version === "" || record.gameVersion === "") return false;

  const loader = variables.LOADER?.trim().toLowerCase() ?? "";
  const loaderVersion = variables.LOADER_VERSION?.trim() ?? "";
  const game = variables.MINECRAFT_VERSION?.trim() ?? "";
  return (
    loader === family &&
    game === record.gameVersion &&
    (loaderVersion === version || loaderVersion.startsWith(`${version}-`))
  );
}

/** « 1.21.1 » → « 21.1. », « 1.21 » → « 21.0. » ; `null` hors de la numérotation 1.x. */
function neoforgePrefix(gameVersion: string): string | null {
  const [major, minor, patch] = gameVersion.split(".");
  if (major !== "1" || !minor) return null;
  return `${minor}.${patch ?? "0"}.`;
}

/** Une valeur étrangère citée dans un message, bornée. */
function court(value: string): string {
  return value.length > 40 ? `${value.slice(0, 40)}…` : value;
}
