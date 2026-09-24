import type { EngineOption, EngineVersion } from "@gamedashboard/contracts";
import { Injectable, Logger } from "@nestjs/common";

/**
 * Modpacks Modrinth.
 *
 * Un modpack n'est pas un fichier à poser, et c'est ce qui le sépare d'un jar.
 * Un `.mrpack` est une archive qui ne **contient pas** les mods : elle porte un
 * index (`modrinth.index.json`) listant leurs adresses, plus un dossier
 * `overrides/` de fichiers de configuration à déverser à la racine.
 *
 * L'installer demande donc trois temps, et non un : ouvrir l'archive, aller
 * chercher chaque mod qu'elle désigne, puis déplacer les surcharges. Croire
 * qu'un `.mrpack` déballé suffit donne un serveur sans aucun mod — qui
 * démarre, ce qui est le pire des cas, puisque rien ne signale l'erreur.
 *
 * Tout ce travail a lieu **dans le conteneur**. Le panel lit l'index, qui
 * pèse quelques kilooctets, et laisse le daemon télécharger les centaines de
 * mégaoctets de mods.
 */

const API = "https://api.modrinth.com/v2";
const USER_AGENT = "GameDashboard/GameDashboard (panel de jeu, contact@gamedashboard.fr)";
const TIMEOUT_MS = 8000;
const SEARCH_LIMIT = 12;

/**
 * Hôtes que Modrinth autorise dans un `.mrpack` (spécification du format).
 *
 * Ce sont aussi ceux où Modrinth et CurseForge servent leurs fichiers : la
 * même liste filtre les adresses que leurs API rendent pour une extension ou
 * l'archive d'un pack (`isTrustedDownload`).
 */
const TRUSTED_DOWNLOAD_HOSTS = new Set([
  "cdn.modrinth.com",
  "github.com",
  "raw.githubusercontent.com",
  "gitlab.com",
  "edge.forgecdn.net",
  "mediafilez.forgecdn.net",
  "media.forgecdn.net",
]);

/** Un mod ne pèse pas un giga : au-delà, c'est autre chose. */
const MAX_MOD_BYTES = 512 * 1024 * 1024;

/**
 * L'adresse désigne-t-elle un dépôt connu, en https ?
 *
 * À appeler avant tout `pullFile` sur une adresse **rendue par un tiers** :
 * Wings télécharge sans regarder, depuis le réseau du node. Une réponse
 * falsifiée, ou un projet piégé, ferait sinon du daemon un relais vers
 * `169.254.169.254` ou le réseau d'administration.
 */
export function isTrustedDownload(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && TRUSTED_DOWNLOAD_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Une entrée de l'index : un fichier à poser, et où le poser. */
export interface PackFile {
  /** Chemin relatif à la racine du serveur, tel que le pack le veut. */
  path: string;
  downloads: string[];
}

export interface PackIndex {
  name: string;
  versionId: string;
  files: PackFile[];
}

interface ModrinthHit {
  project_id: string;
  title: string;
  description: string;
}

interface ModrinthVersion {
  id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  date_published: string;
  files: { url: string; filename: string; primary: boolean }[];
}

@Injectable()
export class ModpackSourceService {
  private readonly logger = new Logger(ModpackSourceService.name);

  /**
   * Recherche de modpacks.
   *
   * Filtrée sur `project_type:modpack` : sans ce facette, la recherche rendrait
   * des mods isolés, qui s'installent par le catalogue d'extensions et non ici.
   */
  async search(query: string): Promise<EngineOption[]> {
    const params = new URLSearchParams({
      limit: String(SEARCH_LIMIT),
      index: "downloads",
      facets: JSON.stringify([["project_type:modpack"]]),
    });
    if (query.trim() !== "") params.set("query", query.trim());

    const { hits } = await this.get<{ hits: ModrinthHit[] }>(`/search?${params}`);

    const options = await Promise.all(
      hits.map(async (hit): Promise<EngineOption | null> => {
        const versions = await this.versionsOf(`modpack:${hit.project_id}`).catch(() => []);
        // Un pack sans version exploitable n'est pas proposé : le choisir
        // ouvrirait une liste vide sans rien qui l'explique.
        if (versions.length === 0) return null;

        return {
          id: `modpack:${hit.project_id}`,
          kind: "pack",
          label: hit.title,
          summary: hit.description,
          versions,
        };
      }),
    );

    return options.filter((o): o is EngineOption => o !== null);
  }

  /** Versions d'un pack, la plus récente en tête. */
  async versionsOf(optionId: string): Promise<EngineVersion[]> {
    const slug = optionId.startsWith("modpack:") ? optionId.slice("modpack:".length) : "";
    if (slug === "") return [];

    const versions = await this.get<ModrinthVersion[]>(
      `/project/${encodeURIComponent(slug)}/version`,
    );

    return versions
      .filter((version) => version.files.some((f) => f.filename.endsWith(".mrpack")))
      .slice(0, 20)
      .map((version) => ({
        id: version.id,
        label: `${version.version_number}${version.game_versions[0] ? ` · ${version.game_versions[0]}` : ""}`,
        gameVersion: version.game_versions[0] ?? "",
      }));
  }

  /**
   * L'archive d'une version de pack.
   *
   * Le fichier retenu est celui qui porte l'extension `.mrpack`, et pas le
   * « primaire » : une version peut publier à côté un client, des sources ou
   * un journal des changements, que le daemon n'a rien à faire de télécharger.
   */
  async archiveOf(versionId: string): Promise<{ url: string; fileName: string } | null> {
    const version = await this.get<ModrinthVersion>(
      `/version/${encodeURIComponent(versionId)}`,
    ).catch(() => null);
    if (!version) return null;

    const file = version.files.find((f) => f.filename.endsWith(".mrpack"));
    if (!file) return null;

    return { url: file.url, fileName: file.filename };
  }

  /**
   * Lit l'index d'un pack déjà déballé dans le conteneur.
   *
   * Le contenu arrive du daemon, donc d'un fichier écrit par une archive
   * tierce : il est traité comme une donnée douteuse. Une entrée sans adresse,
   * ou dont le chemin remonte l'arborescence, est écartée — un `../` laisserait
   * un pack écrire hors du serveur.
   */
  parseIndex(raw: string): PackIndex | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn("Index de modpack illisible : JSON invalide.");
      return null;
    }

    const body = parsed as { name?: unknown; versionId?: unknown; files?: unknown };
    if (!Array.isArray(body.files)) return null;

    const files: PackFile[] = [];
    for (const entry of body.files) {
      const file = entry as { path?: unknown; downloads?: unknown };
      if (typeof file.path !== "string" || !Array.isArray(file.downloads)) continue;

      /*
       * Seules les adresses des dépôts connus sont gardées.
       *
       * L'index vient d'une archive tierce, et le daemon télécharge sans
       * regarder : une adresse vers le réseau du node en ferait un relais.
       * Modrinth n'accepte dans ses packs que ces hôtes-là — la liste est la
       * sienne, pas une restriction de plus.
       */
      const downloads = file.downloads.filter(
        (d): d is string => typeof d === "string" && isTrustedDownload(d),
      );
      if (downloads.length === 0) {
        this.logger.warn(`Mod ${String(file.path)} sans adresse de téléchargement acceptable.`);
        continue;
      }

      // Un chemin qui remonte ou qui part de la racine sortirait du serveur.
      if (file.path.includes("..") || file.path.startsWith("/")) {
        this.logger.warn(`Chemin de modpack refusé : « ${file.path} ».`);
        continue;
      }

      // Une taille annoncée démesurée est refusée avant le téléchargement :
      // le daemon n'a pas de plafond de son côté.
      const fileSize = (entry as { fileSize?: unknown }).fileSize;
      if (typeof fileSize === "number" && fileSize > MAX_MOD_BYTES) {
        this.logger.warn(`Mod ${file.path} refusé : ${fileSize} octets annoncés.`);
        continue;
      }

      files.push({ path: file.path, downloads });
    }

    return {
      name: typeof body.name === "string" ? body.name : "Modpack",
      versionId: typeof body.versionId === "string" ? body.versionId : "",
      files,
    };
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${API}${path}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Modrinth a répondu ${response.status}.`);
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
