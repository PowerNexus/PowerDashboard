import { ConflictException, Logger } from "@nestjs/common";
import type { WingsClientService } from "../wings/wings-client.service";
import { cheminSur, dossiersDe, empreinte } from "./pack-files";

/**
 * Le dossier de travail d'une installation de modpack, **dans le conteneur**.
 *
 * L'archive y est tirée et ouverte par le daemon, à l'écart de l'arborescence
 * du serveur : un pack refusé en cours de route (fichier non distribuable,
 * index illisible) n'a alors rien touché, et le dossier est simplement retiré.
 * Seul ce qui est retenu en sort, fichier par fichier.
 *
 * Tout passe par le contrat de Wings tel qu'il est — tirer, extraire, lister,
 * déplacer, supprimer — et ses limites relevées dans sa source décident des
 * réglages ci-dessous.
 */

/** Nom du dossier de travail, à la racine du serveur. */
export const STAGING = ".gamedashboard-pack";

/**
 * Téléchargements simultanés.
 *
 * Wings refuse au-delà de **trois** téléchargements en cours par serveur
 * (`postServerPullRemoteFile` : « reached its limit of 3 simultaneous remote
 * file downloads »), y compris ceux au premier plan. Six de front, comme
 * auparavant, faisaient échouer la moitié des mods d'un pack — et l'échec,
 * avalé, était compté comme une réussite.
 */
export const PULL_CONCURRENCY = 3;

/** Au-delà, ce n'est plus un modpack mais une arborescence à déplacer à la main. */
const MAX_FILES = 20_000;
const MAX_DIRECTORIES = 2_000;

/** Déplacements et suppressions par requête : un corps borné, une erreur localisée. */
const BATCH = 50;

export interface TreeFile {
  /** Chemin relatif à la base listée. */
  path: string;
  fingerprint: string;
}

export class PackWorkspace {
  private readonly logger = new Logger(PackWorkspace.name);

  constructor(
    private readonly wings: WingsClientService,
    private readonly serverId: string,
  ) {}

  /** Repart d'un dossier de travail vide : un essai interrompu a pu en laisser un. */
  async reset(): Promise<void> {
    await this.wings.deleteFiles(this.serverId, "/", [STAGING]).catch(() => undefined);
  }

  /** Retire le dossier de travail, quoi qu'il arrive à l'installation. */
  async cleanup(): Promise<void> {
    await this.reset();
  }

  /** Tire une archive dans le dossier de travail et l'y ouvre. */
  async unpack(url: string, fileName: string): Promise<void> {
    await this.wings.pullFile(this.serverId, `/${STAGING}`, url, fileName);
    await this.wings.decompressFile(this.serverId, `/${STAGING}`, fileName);
    await this.wings.deleteFiles(this.serverId, `/${STAGING}`, [fileName]).catch(() => undefined);
  }

  /** Lit un fichier texte du dossier de travail, `null` s'il manque. */
  async read(path: string): Promise<string | null> {
    return this.wings.readFile(this.serverId, `${STAGING}/${path}`).catch(() => null);
  }

  /**
   * La base réelle de l'archive.
   *
   * Beaucoup de « server packs » CurseForge enveloppent tout dans un dossier
   * (« Pack 1.2 Server Files/… »). Quand la racine de l'archive ne contient
   * qu'un dossier et rien d'autre, c'est lui, la base.
   */
  async base(): Promise<string> {
    const entries = await this.list("");
    const visible = entries.filter((entry) => !entry.symlink);
    const only = visible[0];
    if (visible.length === 1 && only?.directory && cheminSur(only.name)) return only.name;
    return "";
  }

  /**
   * Tous les fichiers sous `base` (relatif au dossier de travail), récursivement.
   *
   * Les liens symboliques sont écartés : un pack n'en a pas besoin, et en
   * suivre un reviendrait à laisser l'archive choisir ce qu'on déplace. Les
   * noms qui ne sont pas des chemins sûrs sont écartés et consignés.
   */
  async tree(base: string): Promise<TreeFile[]> {
    const files: TreeFile[] = [];
    const queue = [""];
    let directories = 0;

    while (queue.length > 0) {
      const relative = queue.shift() as string;
      directories += 1;
      if (directories > MAX_DIRECTORIES || files.length > MAX_FILES) {
        throw new ConflictException(
          "Ce modpack compte trop de fichiers pour être installé par le panel. Installez-le par SFTP.",
        );
      }

      const at = [base, relative].filter(Boolean).join("/");
      for (const entry of await this.list(at)) {
        const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
        if (entry.symlink) continue;
        if (!cheminSur(path)) {
          this.logger.warn(`Entrée d'archive écartée : « ${path} ».`);
          continue;
        }
        if (entry.directory) queue.push(path);
        else if (entry.file) files.push({ path, fingerprint: empreinte(entry) });
      }
    }

    return files;
  }

  /**
   * Empreintes actuelles, à la racine du serveur, des chemins donnés.
   *
   * Un listage par dossier concerné, et non par fichier : un pack de trois
   * cents fichiers tient dans une trentaine de dossiers.
   */
  async fingerprints(paths: Iterable<string>): Promise<Record<string, string>> {
    const wanted = new Set(paths);
    const found: Record<string, string> = {};
    const directories = dossiersDe(wanted);
    if (directories.length > MAX_DIRECTORIES) {
      throw new ConflictException("Trop de dossiers à relire pour suivre ce modpack.");
    }

    for (const directory of directories) {
      const entries = await this.wings
        .listDirectory(this.serverId, `/${directory}`)
        .catch(() => []);
      for (const entry of entries) {
        if (!entry.file || entry.symlink) continue;
        const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
        if (wanted.has(path)) found[path] = empreinte(entry);
      }
    }
    return found;
  }

  /** Supprime des chemins de la racine du serveur, par lots. */
  async remove(paths: string[]): Promise<void> {
    for (let i = 0; i < paths.length; i += BATCH) {
      const slice = paths.slice(i, i + BATCH);
      await this.wings.deleteFiles(this.serverId, "/", slice).catch((error) => {
        this.logger.warn(`Suppression partielle : ${describe(error)}`);
      });
    }
  }

  /**
   * Déplace des fichiers du dossier de travail vers la racine du serveur.
   *
   * Wings refuse un déplacement vers une destination existante : c'est
   * pourquoi l'ancien `overrides/config` ne rejoignait jamais un `config/` déjà
   * présent — c'est-à-dire sur tout serveur qui avait démarré une fois. Les
   * destinations sont donc retirées d'abord (`replace`), et le déplacement
   * se fait fichier par fichier, par lots. Rend les chemins non déplacés.
   */
  async move(moves: { from: string; to: string }[], replace: string[]): Promise<string[]> {
    await this.remove(replace);
    const failed: string[] = [];

    for (let i = 0; i < moves.length; i += BATCH) {
      const slice = moves.slice(i, i + BATCH).map((move) => ({
        from: `${STAGING}/${move.from}`,
        to: move.to,
      }));
      try {
        await this.wings.renameFiles(this.serverId, "/", slice);
      } catch {
        // Le lot a échoué sur une entrée ; les autres ont pu passer. On les
        // reprend une à une pour savoir lesquelles manquent vraiment.
        for (const move of slice) {
          await this.wings
            .renameFiles(this.serverId, "/", [move])
            .catch(() => failed.push(move.to));
        }
      }
    }
    return failed;
  }

  /**
   * Fait tirer des fichiers par le daemon, trois à la fois (limite de Wings).
   *
   * Un échec est retenté une fois, puis **rendu** : il est dit à l'écran avec
   * le nom du fichier, et non compté comme posé.
   */
  async pull(items: { url: string; path: string }[]): Promise<string[]> {
    const failed: string[] = [];
    let next = 0;

    const worker = async () => {
      while (next < items.length) {
        const item = items[next++] as { url: string; path: string };
        const at = item.path.lastIndexOf("/");
        const root = at === -1 ? "/" : `/${item.path.slice(0, at)}`;
        const name = at === -1 ? item.path : item.path.slice(at + 1);
        try {
          await this.wings.pullFile(this.serverId, root, item.url, name);
        } catch {
          try {
            await this.wings.pullFile(this.serverId, root, item.url, name);
          } catch (error) {
            this.logger.warn(`Fichier ${item.path} non posé : ${describe(error)}`);
            failed.push(item.path);
          }
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(PULL_CONCURRENCY, items.length) }, worker));
    return failed;
  }

  private list(relative: string) {
    const at = relative === "" ? `/${STAGING}` : `/${STAGING}/${relative}`;
    return this.wings.listDirectory(this.serverId, at).catch(() => []);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
