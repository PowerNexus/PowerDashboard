import { z } from "zod";

/**
 * Le moteur d'un serveur : ce qu'il **est**, et non ce qu'on lui ajoute.
 *
 * Un jar de serveur et un modpack sont la même opération vue de deux hauteurs.
 * Installer Paper remplace le programme ; installer un modpack remplace le
 * programme **et** ce qui l'accompagne. Dans les deux cas on change la nature
 * du serveur, on écrase l'existant, et il faut redémarrer. Les séparer en deux
 * écrans obligerait à deviner lequel ouvrir pour une question qu'on se pose
 * d'un seul tenant : « qu'est-ce que ce serveur fait tourner ? »
 *
 * C'est aussi ce qui les distingue du catalogue d'extensions : un plugin
 * s'ajoute et se retire sans que le serveur cesse d'être ce qu'il est.
 */

export const EngineKind = z.enum(["jar", "pack"]);
export type EngineKind = z.infer<typeof EngineKind>;

/**
 * Une version installable d'un moteur.
 *
 * `id` est ce que l'on renvoie pour installer ; `label` est ce qu'on lit.
 * Les deux diffèrent souvent — « 1.20.1 build 196 » se choisit, mais c'est le
 * numéro de build qui décide du fichier.
 */
export const EngineVersion = z.object({
  id: z.string(),
  label: z.string(),
  /** Version de jeu visée, quand elle est connue. Vide pour un proxy. */
  gameVersion: z.string(),
});
export type EngineVersion = z.infer<typeof EngineVersion>;

/**
 * Un moteur proposé : une plateforme de serveur, ou un modpack.
 *
 * Même forme pour les deux, et c'est le but : l'écran n'a pas à savoir ce
 * qu'il affiche pour l'afficher correctement.
 */
export const EngineOption = z.object({
  /** Préfixé par sa source, comme les projets du catalogue : `paper:paper`, `modrinth:AABB`. */
  id: z.string(),
  kind: EngineKind,
  label: z.string(),
  summary: z.string(),
  /** Le plus récent en tête : c'est celui qu'on installe neuf fois sur dix. */
  versions: z.array(EngineVersion),
  /**
   * Catalogue d'origine d'un modpack (`modrinth`, `curseforge`), pour le dire
   * à l'écran : deux packs du même nom peuvent venir de l'un et de l'autre.
   */
  source: z.string().optional(),
});
export type EngineOption = z.infer<typeof EngineOption>;

/** Catalogues de modpacks pris en charge. */
export const PackSource = z.enum(["modrinth", "curseforge"]);
export type PackSource = z.infer<typeof PackSource>;

/**
 * Ce que le serveur exécute aujourd'hui, tel que le panel l'a posé.
 *
 * Retenu en base à chaque installation par le panel (`server_engines`), et
 * oublié quand le daemon réinstalle le serveur depuis son egg : ce qui tourne
 * alors est ce que le script de l'egg a posé, et le panel ne le sait pas.
 * `null` veut donc dire « le panel ne l'a pas posé », jamais « rien ».
 */
export const InstalledEngine = z.object({
  optionId: z.string(),
  kind: EngineKind,
  label: z.string(),
  versionId: z.string(),
  versionLabel: z.string(),
  /** Version de Minecraft visée, vide quand elle n'est pas connue. */
  gameVersion: z.string(),
  /** Chargeur demandé par le pack (« fabric 0.16.10 », « forge 47.3.0 »), s'il le dit. */
  loader: z.string().nullable(),
  /** Catalogue et projet d'un modpack ; `null` pour une plateforme. */
  pack: z.object({ source: PackSource, projectId: z.string() }).nullable(),
  /** Nombre de fichiers posés par le pack et suivis pour ses mises à jour. */
  trackedFiles: z.number().int().nonnegative(),
  /**
   * Version plus récente et compatible (même version de Minecraft, même
   * chargeur), relevée par la veille ; `null` : à jour, ou pas encore vérifié.
   */
  update: z.object({ versionId: z.string(), label: z.string() }).nullable(),
  checkedAt: z.string().datetime({ offset: true }).nullable(),
  installedAt: z.string().datetime({ offset: true }),
});
export type InstalledEngine = z.infer<typeof InstalledEngine>;

/** Ce qu'une installation de moteur a fait, pour l'écran et le journal. */
export const EngineInstallReport = z.object({
  label: z.string(),
  /** Fichiers écrits. */
  files: z.number().int().nonnegative(),
  /** Fichiers que le pack demandait et qui n'ont pas pu être posés. */
  missing: z.array(z.string()),
  /** Fichiers gardés tels quels : modifiés depuis la version précédente, ou au serveur. */
  kept: z.array(z.string()),
  /** Fichiers de la version précédente du pack retirés. */
  removed: z.number().int().nonnegative(),
  /** Ce qui reste à faire à la main, en clair (chargeur non posé, fichiers du client…). */
  notice: z.string().nullable(),
  /**
   * Chargeur posé avec le pack (« Forge 47.3.0 pour Minecraft 1.20.1 ») :
   * Fabric par son jar, Forge et NeoForge par leur installeur, que lance une
   * réinstallation de l'egg « Minecraft Java ». `null` quand aucun ne l'a été.
   */
  loader: z.string().nullable(),
  /** L'acceptation du contrat de licence a été retirée (nouveau moteur). */
  eulaReset: z.boolean(),
});
export type EngineInstallReport = z.infer<typeof EngineInstallReport>;

export const EngineInstallStatus = z.enum(["running", "done", "failed"]);
export type EngineInstallStatus = z.infer<typeof EngineInstallStatus>;

/**
 * La dernière installation de moteur lancée sur un serveur.
 *
 * Une installation part **en tâche de fond** : un modpack enchaîne des
 * centaines de téléchargements, et la sauvegarde préalable peut prendre une
 * demi-heure — aucune requête HTTP ne tient jusque-là. L'écran relit cet état
 * tant qu'il vaut `running`, puis montre le compte rendu (`done`) ou la raison
 * de l'échec (`failed`).
 */
export const EngineInstallRun = z.object({
  status: EngineInstallStatus,
  optionId: z.string(),
  versionId: z.string(),
  /** Ce qui est installé, lisible. */
  label: z.string(),
  startedAt: z.string().datetime({ offset: true }),
  finishedAt: z.string().datetime({ offset: true }).nullable(),
  /** Compte rendu, quand l'installation est terminée. */
  report: EngineInstallReport.nullable(),
  /** Raison de l'échec, en clair. */
  error: z.string().nullable(),
});
export type EngineInstallRun = z.infer<typeof EngineInstallRun>;

/**
 * Chargeur d'un modpack, lu dans le vocabulaire de son catalogue.
 *
 * CurseForge l'écrit « forge-47.2.0 » dans `manifest.json` et « Forge » dans
 * ses versions de jeu ; Modrinth « fabric-loader » dans les dépendances d'un
 * `.mrpack`. Les quatre familles connues seulement : un mot inconnu rend
 * `null`, et l'installation le refuse plutôt que de deviner.
 */
export type PackLoader = "fabric" | "quilt" | "forge" | "neoforge";

export function packLoaderOf(value: string): { loader: PackLoader; version: string } | null {
  const match = value
    .trim()
    .toLowerCase()
    .match(/^(fabric-loader|quilt-loader|fabric|quilt|neoforge|forge)(?:-(.+))?$/);
  if (!match?.[1]) return null;
  const family = match[1].replace(/-loader$/, "") as PackLoader;
  return { loader: family, version: match[2] ?? "" };
}

/**
 * Le chargeur d'un pack convient-il au chargeur détecté du serveur ?
 *
 * Refuser plutôt que basculer : un egg Forge lance `@unix_args.txt`, un egg
 * Fabric un jar. Poser un pack Fabric sur le premier donnerait un serveur qui
 * ne démarre plus, avec à l'écran une installation réussie. NeoForge est reconnu
 * par la détection comme un Forge (même famille d'eggs) ; Quilt n'est proposé
 * nulle part (voir `ENGINE_EXCLUSIONS`).
 */
export function packFitsServer(packLoader: PackLoader, serverLoader: string): boolean {
  if (packLoader === "fabric") return serverLoader === "fabric";
  if (packLoader === "forge" || packLoader === "neoforge") return serverLoader === "forge";
  return false;
}

/**
 * Ce qu'un serveur **est**, pour savoir quelles plateformes lui conviennent.
 *
 * `game` héberge un monde, `proxy` se place devant plusieurs serveurs et n'en
 * héberge aucun. C'est la seule distinction qui compte pour proposer un
 * changement de moteur — et c'est celle qui manquait.
 *
 * L'écran filtrait auparavant par **famille** : un serveur Paper ne se voyait
 * proposer que Paper, Folia, Purpur et Vanilla. Autrement dit, on ne pouvait
 * changer de chargeur que pour rester dans le même. C'est précisément
 * l'inverse de ce qu'on vient chercher ici : passer de Paper à Fabric est un
 * changement de moteur, pas une anomalie.
 */
export const EngineRole = z.enum(["game", "proxy"]);
export type EngineRole = z.infer<typeof EngineRole>;

/**
 * Le rôle qu'implique le chargeur détecté d'un serveur.
 *
 * `null` pour les jeux qui ne sont pas Minecraft-Java : aucune de ces
 * plateformes ne leur convient, et leur en proposer une poserait un jar que
 * rien ne saurait lancer.
 */
export function engineRoleOf(loader: string): EngineRole | null {
  if (loader === "velocity") return "proxy";
  if (["paper", "spigot", "fabric", "forge", "vanilla", "any"].includes(loader)) return "game";
  return null;
}

/** Une plateforme connue mais volontairement absente, et la raison. */
export interface EngineExclusion {
  readonly label: string;
  readonly reason: string;
}

/**
 * Pourquoi certaines plateformes ne sont pas proposées.
 *
 * Dire « Quilt n'est pas là » sans dire pourquoi ferait chercher une panne.
 * La raison est un **fait sur l'outil**, relevé chez l'éditeur : la méta de
 * Quilt rend un **profil de lancement JSON** là où celle de Fabric rend un
 * `application/java-archive`. Poser ce fichier à la place du serveur donnerait
 * un jar qui ne démarre pas.
 *
 * Forge et NeoForge n'y figurent plus : ils ne publient qu'un installeur, mais
 * le panel le fait exécuter par l'egg « Minecraft Java » (réinstallation, mondes
 * et mods conservés) quand un modpack les demande. Ils arrivent donc avec leur
 * pack, et l'écran des modpacks le dit.
 */
export const ENGINE_EXCLUSIONS: EngineExclusion[] = [
  {
    label: "Quilt",
    reason:
      "Sa méta rend un profil de lancement, pas un serveur exécutable — là où celle de Fabric rend bien un jar. Le poser tel quel ne donnerait rien de lançable.",
  },
];

/**
 * Un changement de moteur écrase-t-il des fichiers existants ?
 *
 * Un jar remplace un fichier et un seul. Un modpack déverse des mods et des
 * configurations par-dessus l'arborescence : ce qui s'y trouvait déjà peut
 * disparaître. La différence doit être dite **avant** de cliquer, parce
 * qu'elle ne se rattrape pas après.
 */
export function overwritesServerFiles(kind: EngineKind): boolean {
  return kind === "pack";
}

/**
 * Version de Java qu'exige une version de Minecraft.
 *
 * **Relevé sur un vrai serveur** : installer Paper 1.21 sur un egg réglé en
 * Java 8 donne « Minecraft 1.19 requires running the server with Java 17 or
 * above » et un conteneur qui sort en code 1. Le jar était pourtant
 * parfaitement posé — changer le moteur sans changer l'image de conteneur ne
 * change rien d'utile.
 *
 * Les seuils viennent de Mojang, qui les a relevés trois fois :
 * 1.17 a imposé Java 16, 1.18 Java 17, et 1.20.5 Java 21.
 *
 * `null` quand la version n'est pas lisible : on ne touche alors pas à
 * l'image. Deviner ferait basculer un serveur sur un Java qui ne lui convient
 * pas, pour corriger un problème qu'il n'avait peut-être pas.
 */
export function javaMajorFor(minecraftVersion: string): number | null {
  const match = minecraftVersion.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] ?? "0");

  /*
   * Les versions calendaires — « 26.1 », « 26.3 » — exigent Java 25.
   *
   * Relevé sur un vrai serveur : « Minecraft 26.1 and newer requires running
   * the server with Java 25 or above ». Mojang a relevé le seuil une
   * quatrième fois en changeant de numérotation, et le supposer identique à
   * celui de 1.21 poserait un jar qui refuse de démarrer.
   */
  if (major > 1) return 25;
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 18) return 17;
  if (minor === 17) return 16;
  return 8;
}

/**
 * Choisit, parmi les images déclarées par l'egg, celle qui porte ce Java.
 *
 * **Jamais une image inventée.** Un egg déclare les images sur lesquelles son
 * auteur l'a éprouvé ; en fabriquer une depuis un nom probable ferait tirer au
 * daemon une image qui n'existe pas, ou pire, une image qui existe et qui ne
 * convient pas.
 *
 * À défaut d'une image exacte, la plus proche **au-dessus** : Java 21 fait
 * tourner ce qui demande 17, l'inverse est faux. `null` quand aucune ne
 * convient — l'appelant laisse alors l'image en place et le dit.
 */
export function pickDockerImage(images: Record<string, string>, javaMajor: number): string | null {
  const candidates: { version: number; image: string }[] = [];

  for (const [label, image] of Object.entries(images)) {
    // Le numéro se lit dans l'étiquette comme dans l'adresse : « Java 17 »,
    // « java_17 », « :java_17 ».
    const found = `${label} ${image}`.match(/java[\s_-]*(\d+)/i);
    if (found?.[1]) candidates.push({ version: Number(found[1]), image });
  }

  const exact = candidates.find((c) => c.version === javaMajor);
  if (exact) return exact.image;

  const above = candidates
    .filter((c) => c.version > javaMajor)
    .sort((a, b) => a.version - b.version)[0];
  return above?.image ?? null;
}

/**
 * La source d'un moteur, lue dans son identifiant.
 *
 * Même règle que pour le catalogue d'extensions : le préfixe porte la
 * provenance, pour que deux fournisseurs qui numérotent pareil ne se
 * confondent jamais.
 */
export function engineSourceOf(optionId: string): string {
  return optionId.split(":")[0] ?? "";
}
