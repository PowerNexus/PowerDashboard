import type { EngineOption, EngineVersion } from "@gamedashboard/contracts";
import { Injectable, Logger } from "@nestjs/common";

/**
 * Modpacks Modrinth.
 *
 * Un modpack n'est **pas** un fichier à poser. Un `.mrpack` est une archive
 * qui contient un index — `modrinth.index.json` — listant les mods par leur
 * adresse, plus un dossier `overrides/` de configurations à déverser sur le
 * serveur. Les mods eux-mêmes n'y sont pas.
 *
 * Le déposer tel quel puis le décompresser donnerait donc un serveur avec un
 * index et des configurations, mais aucun mod : un serveur qui démarre en
 * Vanilla, sans que rien ne l'explique. Il faut lire l'index et aller chercher
 * chaque fichier.
 *
 * Le panel ne relaie aucun octet pour autant : il lit l'index **dans le
 * conteneur**, une fois l'archive décompressée par le daemon, puis demande à
 * celui-ci d'aller chercher chaque mod. Les fichiers ne transitent jamais par
 * le panel, même pour un pack de huit cents mégaoctets.
 */

const API = "https://api.modrinth.com/v2";
const USER_AGENT = "GameDashboard/GameDashboard (panel de jeu, contact@gamedashboard.fr)";
const TIMEOUT_MS = 8000;
const SEARCH_LIMIT = 12;
const VERSION_LIMIT = 15;

/** Ce que porte `modrinth.index.json`, réduit à ce dont l'installation a besoin. */
export interface ModpackIndexFile {
  /** Chemin relatif à la racine du serveur, tel que le pack le veut. */
  path: string;
  downloads: string[];
  /**
   * Un fichier peut être marqué facultatif côté serveur : les mods purement
   * graphiques en font partie, et les poser gonflerait l'installation sans
   * rien apporter.
   */
  env?: { server?: string };
}

export interface ModpackIndex {
  name: string;
  files: ModpackIndexFile[];
}

interface ModrinthPackHit {
  project_id: string;
  title: string;
  description: string;
}

interface ModrinthPackVersion {
  id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  files: { url: string; filename: string; primary: boolean }[];
}

@Injectable()
export class ModpackClient {
  private readonly logger = new Logger(ModpackClient.name);

  /** Modpacks les plus téléchargés, ou ceux qui répondent à la recherche. */
  async search(query: string): Promise<EngineOption[]> {
    const params = new URLSearchParams({
      limit: String(SEARCH_LIMIT),
      index: "downloads",
      facets: JSON.stringify([["project_type:modpack"]]),
    });
    if (query.trim() !== "") params.set("query", query.trim());

    const { hits } = await this.get<{ hits: ModrinthPackHit[] }>(`/search?${params}`);

    const options = await Promise.all(
      hits.map(async (hit): Promise<EngineOption | null> => {
        const versions = await this.versionsOf(`modpack:${hit.project_id}`).catch(() => []);
        // Un pack sans version installable est écarté : beaucoup ne publient
        // que des variantes client, qui n'ont pas de serveur à démarrer.
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

  async versionsOf(optionId: string): Promise<EngineVersion[]> {
    const projectId = optionId.startsWith("modpack:") ? optionId.slice("modpack:".length) : "";
    if (projectId === "") return [];

    const versions = await this.get<ModrinthPackVersion[]>(
      `/project/${encodeURIComponent(projectId)}/version`,
    );

    return versions
      .filter((version) => this.archiveOf(version) !== null)
      .slice(0, VERSION_LIMIT)
      .map((version) => ({
        id: version.id,
        // La version de jeu accompagne le nom : c'est elle qui décide si le
        // pack conviendra aux joueurs déjà connectés.
        label: `${version.version_number} · MC ${version.game_versions[0] ?? "?"}`,
        gameVersion: version.game_versions[0] ?? "",
      }));
  }

  /** L'archive `.mrpack` d'une version, à faire chercher par le daemon. */
  async resolve(versionId: string): Promise<{ url: string; fileName: string } | null> {
    const version = await this.get<ModrinthPackVersion>(
      `/version/${encodeURIComponent(versionId)}`,
    );
    return this.archiveOf(version);
  }

  /**
   * Le fichier `.mrpack` d'une version, ou `null`.
   *
   * L'extension est vérifiée et pas seulement le drapeau « primary » : un
   * auteur peut joindre un installeur ou une archive client, et poser celle-ci
   * donnerait un serveur qui ne démarre pas.
   */
  private archiveOf(version: ModrinthPackVersion): { url: string; fileName: string } | null {
    const file =
      version.files.find((f) => f.primary && f.filename.endsWith(".mrpack")) ??
      version.files.find((f) => f.filename.endsWith(".mrpack"));
    return file ? { url: file.url, fileName: file.filename } : null;
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
    } catch (error) {
      this.logger.warn(`Appel modpack en échec : ${describe(error)}`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Les fichiers d'un index qui doivent réellement être posés sur un serveur.
 *
 * `env.server` vaut « unsupported » pour les mods purement graphiques. Les
 * installer alourdirait le serveur de mégaoctets qu'il ne chargera jamais, et
 * certains refusent de démarrer hors d'un client.
 *
 * Une entrée sans adresse est ignorée plutôt que de faire échouer tout le
 * pack : un fichier manquant se voit et se corrige, une installation refusée
 * en bloc laisse le serveur à moitié changé.
 */
export function serverFilesOf(index: ModpackIndex): ModpackIndexFile[] {
  return index.files.filter(
    (file) => file.env?.server !== "unsupported" && (file.downloads[0] ?? "") !== "",
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
