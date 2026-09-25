/**
 * Ce qu'un modpack a le droit d'écrire, et ce qu'une mise à jour remplace.
 *
 * Fonctions pures, sans daemon ni base : c'est ici que se décide ce qui est
 * écrasé, gardé ou retiré, et une décision de cette nature se teste à part.
 *
 * **Ce qui est détectable, et ce qui ne l'est pas.** Le panel ne lit pas le
 * contenu des fichiers (il en poserait des milliers à travers lui). Il retient,
 * pour chaque fichier posé par le pack, l'empreinte que le daemon en donne au
 * listage : taille et date de modification (`empreinte`). À la mise à jour, un
 * fichier dont l'empreinte a changé depuis est tenu pour **modifié par
 * l'utilisateur** et n'est pas écrasé. Conséquences assumées :
 *
 * - un fichier que le serveur réécrit lui-même au démarrage (certains mods
 *   réécrivent leur configuration à chaque lancement) compte comme modifié et
 *   garde son contenu : la mise à jour de ce réglage par l'auteur du pack ne
 *   passe pas, ce qui est le côté prudent de l'erreur ;
 * - une modification qui garderait taille **et** date à l'identique ne se
 *   voit pas — ce qu'un éditeur ordinaire ne fait pas ;
 * - un fichier ajouté par l'utilisateur sous un nom que le pack pose aussi
 *   est écrasé, faute d'empreinte antérieure : l'écran l'annonce avant.
 *
 * Les jars ne sont jamais « modifiés » : on ne retouche pas un mod à la main,
 * et garder l'ancien jar d'un mod mis à jour ferait démarrer le serveur avec
 * deux versions du même mod.
 */

/** Empreinte d'un fichier telle que le listage du daemon permet de la calculer. */
export function empreinte(entry: { size: number; modified: string }): string {
  return `${entry.size}:${entry.modified}`;
}

/**
 * Chemin relatif acceptable, venu d'une archive ou d'une API tierce.
 *
 * Ni absolu, ni remontant, ni vide, ni caché à la racine du serveur (le
 * dossier de travail du panel y vit), ni caractère de contrôle. Wings confine
 * déjà chaque chemin au volume du serveur ; ce contrôle-ci empêche un pack de
 * viser, **dans** ce volume, ce qu'il n'a pas à toucher.
 */
export function cheminSur(value: string): boolean {
  if (value === "" || value.length > 512) return false;
  if (value.startsWith("/") || value.includes("\\")) return false;
  if ([...value].some((c) => c.charCodeAt(0) < 32)) return false;
  const parts = value.split("/");
  return (
    parts.every((part) => part !== "" && part !== "." && part !== "..") &&
    !value.startsWith(".gamedashboard")
  );
}

/**
 * Nom de fichier simple (sans dossier), pour un jar rendu par une API.
 */
export function nomSur(value: string): boolean {
  return cheminSur(value) && !value.includes("/");
}

/** Fichiers de la racine qui appartiennent au serveur, jamais au pack. */
const FICHIERS_DU_SERVEUR = new Set([
  "server.properties",
  "eula.txt",
  "ops.json",
  "whitelist.json",
  "banned-ips.json",
  "banned-players.json",
  "usercache.json",
]);

/** Dossiers de la racine qui appartiennent au serveur. */
const DOSSIERS_DU_SERVEUR = new Set(["logs", "crash-reports", "backups"]);

/**
 * Le chemin appartient-il au serveur plutôt qu'au pack ?
 *
 * Les mondes (`world`, `world_nether`, et tout dossier de la racine qui
 * commence par `world`, hors les datapacks posés par le pack dans leur dossier
 * `datapacks`), les listes de joueurs et `server.properties` ne sont
 * **jamais** écrasés s'ils existent, ni retirés. Un pack qui en publie un les
 * pose sur un serveur neuf, pas sur un serveur qui a déjà vécu.
 */
export function appartientAuServeur(path: string): boolean {
  const [first = "", ...rest] = path.split("/");
  if (rest.length === 0 && FICHIERS_DU_SERVEUR.has(first)) return true;
  // Un datapack posé à même le dossier `datapacks` d'un monde est au pack :
  // sans cette exception, une mise à jour garderait l'ancienne version à côté
  // de la nouvelle, et le monde chargerait les deux.
  if (rest.length === 2 && rest[0] === "datapacks" && !DOSSIERS_DU_SERVEUR.has(first)) return false;
  if (/^world/i.test(first) || DOSSIERS_DU_SERVEUR.has(first)) return true;
  return false;
}

export interface PlanDuPack {
  /** Chemins à écrire (et à remplacer s'ils existent). */
  ecrire: string[];
  /** Chemins que le pack voudrait écrire mais qui sont gardés (modifiés, ou au serveur). */
  garder: string[];
  /** Chemins posés par la version précédente, absents de la nouvelle, inchangés : retirés. */
  retirer: string[];
  /** Chemins posés par la version précédente, absents de la nouvelle mais modifiés : laissés. */
  laisser: string[];
}

/**
 * Décide, fichier par fichier, ce qu'une installation fait.
 *
 * - `precedent` : empreintes retenues à l'installation précédente d'un pack
 *   (vide pour une première installation) ;
 * - `surDisque` : empreintes actuelles des chemins concernés qui existent ;
 * - `entrants` : chemins que la nouvelle version pose.
 */
export function planifier(
  precedent: Record<string, string>,
  surDisque: Record<string, string>,
  entrants: string[],
): PlanDuPack {
  const plan: PlanDuPack = { ecrire: [], garder: [], retirer: [], laisser: [] };
  const nouveaux = new Set(entrants);

  for (const path of nouveaux) {
    const actuel = surDisque[path];
    if (actuel === undefined) {
      plan.ecrire.push(path);
    } else if (appartientAuServeur(path)) {
      plan.garder.push(path);
    } else if (path.endsWith(".jar")) {
      plan.ecrire.push(path);
    } else if (precedent[path] !== undefined && precedent[path] !== actuel) {
      plan.garder.push(path);
    } else {
      plan.ecrire.push(path);
    }
  }

  for (const [path, avant] of Object.entries(precedent)) {
    if (nouveaux.has(path) || appartientAuServeur(path)) continue;
    const actuel = surDisque[path];
    if (actuel === undefined) continue;
    if (actuel === avant || path.endsWith(".jar")) plan.retirer.push(path);
    else plan.laisser.push(path);
  }

  return plan;
}

/**
 * Ce que le suivi retient après l'installation.
 *
 * Les fichiers écrits prennent leur nouvelle empreinte. Un fichier gardé
 * **parce qu'il était modifié** garde l'ancienne : il reste « modifié » aux
 * yeux de la mise à jour suivante, qui ne l'écrasera pas davantage. Un fichier
 * gardé parce qu'il appartient au serveur, ou laissé, sort du suivi : il n'est
 * plus au pack.
 */
export function suiviApres(
  precedent: Record<string, string>,
  plan: PlanDuPack,
  ecrits: Record<string, string>,
): Record<string, string> {
  const suivi: Record<string, string> = { ...ecrits };
  for (const path of plan.garder) {
    const avant = precedent[path];
    if (avant !== undefined && !appartientAuServeur(path)) suivi[path] = avant;
  }
  return suivi;
}

/** Dossiers distincts des chemins donnés (`""` pour la racine). */
export function dossiersDe(paths: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const path of paths) {
    const at = path.lastIndexOf("/");
    set.add(at === -1 ? "" : path.slice(0, at));
  }
  return [...set].sort();
}
