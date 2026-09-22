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
});
export type EngineOption = z.infer<typeof EngineOption>;

/** Ce que le serveur exécute aujourd'hui, tel que le panel l'a posé. */
export const InstalledEngine = z.object({
  optionId: z.string(),
  label: z.string(),
  versionLabel: z.string(),
  installedAt: z.string().datetime(),
});
export type InstalledEngine = z.infer<typeof InstalledEngine>;

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
 * Dire « Forge n'est pas là » sans dire pourquoi ferait chercher une panne.
 * Ces raisons sont des **faits sur l'outil**, relevés chez l'éditeur, et non
 * des limites du panel :
 *
 * - le maven de NeoForge publie `installer`, `universal`, `sources` et
 *   `userdev` — aucun serveur lançable tel quel ;
 * - Forge distribue de même un installeur, listé par ses promotions ;
 * - la méta de Quilt rend un **profil de lancement JSON** là où celle de
 *   Fabric rend un `application/java-archive`. C'est cette différence-là qui
 *   fait que Fabric est proposé et Quilt non.
 *
 * Poser l'un de ces fichiers à la place du serveur donnerait un jar qui ne
 * démarre pas — une panne au redémarrage suivant, pour un écran qui avait dit
 * « installé ».
 */
export const ENGINE_EXCLUSIONS: EngineExclusion[] = [
  {
    label: "Forge et NeoForge",
    reason:
      "Ils ne distribuent pas un serveur prêt à l'emploi mais un installeur, qui doit s'exécuter dans le conteneur pour fabriquer le serveur et télécharger ses bibliothèques. Cela relève du changement de jeu, pas du remplacement d'un fichier : demandez à votre hébergeur de basculer ce serveur sur un egg Forge ou NeoForge, avec réinstallation.",
  },
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
