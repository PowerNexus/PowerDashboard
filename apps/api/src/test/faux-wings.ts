import type { WingsDirectoryEntry } from "../modules/wings/wings-client.service";

/**
 * Un daemon en mémoire, fidèle aux points du contrat de Wings dont dépend
 * l'installation d'un modpack (relevés dans sa source) :
 *
 * - `files/pull` : au plus **trois** téléchargements simultanés par serveur,
 *   au-delà un refus ; le fichier existant est écrasé (`O_TRUNC`) ;
 * - `files/rename` : une destination existante fait échouer la requête, les
 *   parents de la destination sont créés, une source absente est ignorée ;
 * - `files/delete` : récursif, une entrée absente n'est pas une erreur ;
 * - `files/list-directory` : entrées directes, avec taille et date.
 *
 * Les archives sont des dictionnaires « chemin → contenu », rangés par
 * adresse : `decompress` déverse celle que désigne le fichier tiré.
 */
export class FauxWings {
  readonly files = new Map<string, { content: string; modified: string }>();
  readonly archives = new Map<string, Record<string, string>>();
  readonly failing = new Set<string>();
  readonly pulled: string[] = [];
  readonly events: string[] = [];
  maxActive = 0;
  private active = 0;
  private clock = 0;

  put(path: string, content: string): void {
    this.files.set(norm(path), { content, modified: this.stamp() });
  }

  /** Simule une retouche de l'utilisateur : nouveau contenu, nouvelle date. */
  touch(path: string, content: string): void {
    this.put(path, content);
  }

  has(path: string): boolean {
    return this.files.has(norm(path));
  }

  read(path: string): string | undefined {
    return this.files.get(norm(path))?.content;
  }

  /** Chemins présents sous un préfixe (tous si vide). */
  under(prefix = ""): string[] {
    return [...this.files.keys()].filter((p) => prefix === "" || p.startsWith(`${prefix}/`)).sort();
  }

  power = async (_server: string, signal: string) => {
    this.events.push(`power:${signal}`);
  };

  syncServer = async () => {};

  pullFile = async (_server: string, root: string, url: string, fileName: string) => {
    this.active += 1;
    try {
      if (this.active > 3) {
        throw new Error(
          "This server has reached its limit of 3 simultaneous remote file downloads",
        );
      }
      this.maxActive = Math.max(this.maxActive, this.active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (this.failing.has(url))
        throw new Error("downloader: got bad response status from endpoint");
      this.pulled.push(url);
      this.events.push(`pull:${url}`);
      this.put(join(root, fileName), this.archives.has(url) ? `archive:${url}` : `jar:${url}`);
    } finally {
      this.active -= 1;
    }
  };

  decompressFile = async (_server: string, root: string, file: string) => {
    const content = this.read(join(root, file)) ?? "";
    const archive = this.archives.get(content.replace(/^archive:/, ""));
    if (!archive) throw new Error("The archive provided is in a format Wings does not understand.");
    for (const [path, body] of Object.entries(archive)) this.put(join(root, path), body);
  };

  readFile = async (_server: string, file: string) => {
    const found = this.read(file);
    if (found === undefined) throw new Error("not found");
    return found;
  };

  listDirectory = async (_server: string, directory: string): Promise<WingsDirectoryEntry[]> => {
    const base = norm(directory);
    const seen = new Map<string, WingsDirectoryEntry>();
    for (const [path, file] of this.files) {
      if (base !== "" && !path.startsWith(`${base}/`)) continue;
      const rest = base === "" ? path : path.slice(base.length + 1);
      const [name = "", ...deeper] = rest.split("/");
      if (seen.has(name)) continue;
      seen.set(name, entry(name, deeper.length > 0, file));
    }
    return [...seen.values()];
  };

  renameFiles = async (_server: string, root: string, moves: { from: string; to: string }[]) => {
    let exists = false;
    for (const move of moves) {
      const from = join(root, move.from);
      const to = join(root, move.to);
      const file = this.files.get(from);
      if (!file) continue;
      if (this.files.has(to) || this.under(to).length > 0) {
        exists = true;
        continue;
      }
      this.files.delete(from);
      this.files.set(to, file);
    }
    if (exists) throw new Error("Cannot move or rename file, destination already exists.");
  };

  renameFile = async (server: string, root: string, from: string, to: string) =>
    this.renameFiles(server, root, [{ from, to }]);

  deleteFiles = async (_server: string, root: string, files: string[]) => {
    for (const file of files) {
      const target = join(root, file);
      this.files.delete(target);
      for (const path of this.under(target)) this.files.delete(path);
    }
  };

  private stamp(): string {
    this.clock += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.clock)).toISOString();
  }
}

function norm(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

function join(root: string, name: string): string {
  return norm([norm(root), norm(name)].filter(Boolean).join("/"));
}

function entry(
  name: string,
  directory: boolean,
  file: { content: string; modified: string },
): WingsDirectoryEntry {
  return {
    name,
    mode: "",
    mode_bits: "",
    size: directory ? 4096 : file.content.length,
    directory,
    file: !directory,
    symlink: false,
    mime: "",
    created: file.modified,
    modified: file.modified,
  };
}
