import {
  type EngineOption,
  type EngineVersion,
  type PackLoader,
  packFitsServer,
  packLoaderOf,
} from "@gamedashboard/contracts";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { CurseForgeClient } from "./curseforge.client";
import { isTrustedDownload } from "./modpack-source";
import { cheminSur, nomSur } from "./pack-files";

/**
 * Modpacks CurseForge.
 *
 * Deux formes, et le panel préfère la première :
 *
 * 1. **Le pack serveur** (`serverPackFileId` sur le fichier du pack) : une
 *    archive prête, que l'auteur a composée pour un serveur — mods du seul
 *    client déjà retirés, chargeur souvent joint. On la tire, on l'ouvre, on
 *    en déplace le contenu.
 * 2. **L'archive client**, faute de mieux : elle ne contient pas les mods mais
 *    un `manifest.json` qui les désigne par `projectID`/`fileID`, plus un
 *    dossier de surcharges (`overrides`, nom donné par le manifeste). Les
 *    fichiers sont résolus en lot (`POST /v1/mods/files`), leur nature par
 *    `POST /v1/mods` (les mods, classe 6, vont dans `mods/` ; les datapacks,
 *    classe 6945, dans le dossier `datapacks` du monde ; packs de ressources
 *    et shaders sont du client), puis tirés par le daemon.
 *
 * **Un fichier dont `downloadUrl` est nul** appartient à un auteur qui refuse
 * la distribution par l'API. Le panel ne le contourne pas : l'installation est
 * refusée **avant toute écriture**, en nommant les fichiers en cause — un
 * serveur à qui il manque un mod ne démarre pas, ou pire, démarre sans lui.
 *
 * CurseForge ne marque pas les mods « client seulement » dans le manifeste :
 * c'est la limite de la seconde forme, et la raison de préférer la première.
 */

/** Minecraft chez CurseForge, et sa classe « Modpacks ». */
const MINECRAFT = 432;
const MODPACK_CLASS = 4471;

/**
 * Classes de projet CurseForge (Minecraft).
 *
 * Les mods vont dans `mods/`. Les datapacks vont dans le dossier `datapacks`
 * du monde : c'est là que le serveur les charge, et nulle part ailleurs — les
 * écarter comme « du client » faisait démarrer le pack sans ses recettes ni
 * ses structures, sans rien en dire. Packs de ressources et shaders ne servent
 * qu'au client. Toute autre classe (mondes, personnalisations…) n'a pas de
 * place connue sur un serveur : elle est écartée **et nommée** au compte rendu.
 */
const MOD_CLASS = 6;
const DATAPACK_CLASS = 6945;
const CLIENT_CLASSES = new Set([12, 6552]);

/** Types de chargeur, tels que CurseForge les numérote. */
const MOD_LOADER_TYPE: Record<string, number> = { forge: 1, fabric: 4, neoforge: 6 };

const SEARCH_LIMIT = 12;
const VERSION_LIMIT = 20;
/** Taille d'un lot pour les résolutions en masse. */
const LOT = 200;

/** Un mod ne pèse pas un giga ; une archive de pack serveur, parfois plusieurs. */
const MAX_MOD_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024 * 1024;

export interface CurseForgeFile {
  id: number;
  modId: number;
  displayName: string;
  fileName: string;
  /** Nul lorsque l'auteur refuse la distribution par un tiers. */
  downloadUrl: string | null;
  fileDate: string;
  fileLength?: number;
  /** 1 stable, 2 bêta, 3 alpha. */
  releaseType?: number;
  gameVersions: string[];
  isServerPack?: boolean;
  serverPackFileId?: number | null;
}

interface CurseForgeMod {
  id: number;
  name: string;
  summary: string;
  classId?: number;
  allowModDistribution?: boolean | null;
}

export interface CurseForgeManifest {
  name: string;
  gameVersion: string;
  loader: { loader: PackLoader; version: string } | null;
  /** Fichiers obligatoires ; les facultatifs ne vont pas sur un serveur. */
  files: { projectID: number; fileID: number }[];
  /** Dossier des surcharges, relatif à la racine de l'archive. */
  overrides: string;
}

/** Ce que la résolution d'un manifeste donne à installer. */
export interface ResolvedManifest {
  /** Mods, à tirer dans `mods/`. */
  pulls: { url: string; path: string }[];
  /** Datapacks, à tirer dans le dossier `datapacks` du monde (nom de fichier sûr). */
  datapacks: { url: string; fileName: string }[];
  /** Fichiers que leur auteur refuse de laisser distribuer : l'installation s'arrête. */
  blocked: string[];
  /** Fichiers du manifeste introuvables chez CurseForge, ou refusés (adresse, taille, nom). */
  unusable: string[];
  /** Fichiers écartés parce qu'ils ne servent qu'au client (ressources, shaders). */
  clientOnly: number;
  /** Projets d'une classe qui n'a pas de place connue sur un serveur, nommés. */
  skipped: string[];
}

@Injectable()
export class CurseForgePackService {
  private readonly logger = new Logger(CurseForgePackService.name);

  constructor(@Inject(CurseForgeClient) private readonly client: CurseForgeClient) {}

  /**
   * Recherche de modpacks, restreinte au chargeur du serveur.
   *
   * Lève `CurseForgeUnavailableError` sans clé : l'appelant le dit à l'écran
   * au lieu de rendre une liste vide qu'on prendrait pour « rien trouvé ».
   */
  async search(query: string, serverLoader: string): Promise<EngineOption[]> {
    const params = new URLSearchParams({
      gameId: String(MINECRAFT),
      classId: String(MODPACK_CLASS),
      searchFilter: query.trim(),
      sortField: "2",
      sortOrder: "desc",
      pageSize: String(SEARCH_LIMIT),
    });
    // Forge et NeoForge partagent les eggs « forge » : pas de filtre à la
    // recherche, les versions le font ensuite.
    if (serverLoader === "fabric") params.set("modLoaderType", String(MOD_LOADER_TYPE.fabric));

    const { data } = await this.client.call<{ data: CurseForgeMod[] }>(`/mods/search?${params}`);

    const options = await Promise.all(
      data.map(async (mod): Promise<EngineOption | null> => {
        const versions = await this.versionsOf(mod.id, serverLoader).catch(() => []);
        if (versions.length === 0) return null;
        return {
          id: `curseforge-pack:${mod.id}`,
          kind: "pack",
          label: mod.name,
          summary: mod.summary,
          versions,
          source: "curseforge",
        };
      }),
    );
    return options.filter((option): option is EngineOption => option !== null);
  }

  /** Versions d'un pack (fichiers « client », jamais les packs serveur eux-mêmes). */
  async versionsOf(modId: number, serverLoader: string): Promise<EngineVersion[]> {
    const { data } = await this.client.call<{ data: CurseForgeFile[] }>(
      `/mods/${modId}/files?pageSize=50`,
    );
    return data
      .filter((file) => !file.isServerPack)
      .filter((file) => {
        const loader = fileLoaderOf(file);
        return serverLoader === "" || loader === null || packFitsServer(loader, serverLoader);
      })
      .sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate))
      .slice(0, VERSION_LIMIT)
      .map((file) => ({
        id: String(file.id),
        label: `${file.displayName}${gameVersionOf(file) ? ` · ${gameVersionOf(file)}` : ""}`,
        gameVersion: gameVersionOf(file),
      }));
  }

  /** Nom d'un pack, pour le suivi. */
  async projectName(modId: number): Promise<string> {
    const { data } = await this.client.call<{ data: CurseForgeMod }>(`/mods/${modId}`);
    return data.name;
  }

  /**
   * Un fichier du pack, **vérifié comme appartenant à ce pack**.
   *
   * Le couple vient du navigateur : sans ce contrôle, un identifiant de
   * fichier pris dans un autre projet ferait installer autre chose que ce que
   * l'écran annonçait.
   */
  async file(modId: number, fileId: number): Promise<CurseForgeFile | null> {
    const found = await this.client
      .call<{ data: CurseForgeFile }>(`/mods/${modId}/files/${fileId}`)
      .then((response) => response.data)
      .catch(() => null);
    return found && found.modId === modId ? found : null;
  }

  /**
   * Le pack serveur publié avec ce fichier, s'il existe et s'il est
   * téléchargeable depuis un dépôt connu.
   */
  async serverPackOf(file: CurseForgeFile): Promise<CurseForgeFile | null> {
    if (!file.serverPackFileId) return null;
    const pack = await this.file(file.modId, file.serverPackFileId);
    if (!pack?.downloadUrl || !isTrustedDownload(pack.downloadUrl) || !nomSur(pack.fileName)) {
      return null;
    }
    if ((pack.fileLength ?? 0) > MAX_ARCHIVE_BYTES) return null;
    return pack;
  }

  /**
   * Résout les fichiers d'un manifeste en adresses à faire tirer.
   *
   * Deux appels en lot (fichiers, puis projets pour leur classe) au lieu d'un
   * par mod : un pack en compte trois cents, et CurseForge limite le débit.
   */
  async resolve(manifest: CurseForgeManifest): Promise<ResolvedManifest> {
    const files = await this.batch<CurseForgeFile>(
      "/mods/files",
      "fileIds",
      manifest.files.map((f) => f.fileID),
    );
    const byId = new Map(files.map((file) => [file.id, file]));
    const mods = await this.batch<CurseForgeMod>("/mods", "modIds", [
      ...new Set(manifest.files.map((f) => f.projectID)),
    ]);
    const modById = new Map(mods.map((mod) => [mod.id, mod]));

    const out: ResolvedManifest = {
      pulls: [],
      datapacks: [],
      blocked: [],
      unusable: [],
      clientOnly: 0,
      skipped: [],
    };
    for (const entry of manifest.files) {
      const file = byId.get(entry.fileID);
      const mod = modById.get(entry.projectID);
      if (!file || file.modId !== entry.projectID) {
        out.unusable.push(`${mod?.name ?? `projet ${entry.projectID}`} (fichier ${entry.fileID})`);
        continue;
      }
      // La classe n'est connue que par le projet ; un projet muet est tenu
      // pour un mod, ce qu'il est dans l'immense majorité des packs.
      const classId = mod?.classId ?? MOD_CLASS;
      if (CLIENT_CLASSES.has(classId)) {
        out.clientOnly += 1;
        continue;
      }
      if (classId !== MOD_CLASS && classId !== DATAPACK_CLASS) {
        out.skipped.push(mod?.name ?? file.displayName);
        continue;
      }
      if (!file.downloadUrl) {
        out.blocked.push(mod?.name ?? file.displayName);
        continue;
      }
      if (
        !isTrustedDownload(file.downloadUrl) ||
        !nomSur(file.fileName) ||
        (file.fileLength ?? 0) > MAX_MOD_BYTES
      ) {
        this.logger.warn(`Fichier CurseForge refusé : ${file.fileName} (${file.downloadUrl}).`);
        out.unusable.push(file.fileName);
        continue;
      }
      if (classId === DATAPACK_CLASS) {
        out.datapacks.push({ url: file.downloadUrl, fileName: file.fileName });
      } else {
        out.pulls.push({ url: file.downloadUrl, path: `mods/${file.fileName}` });
      }
    }
    return out;
  }

  /**
   * Version plus récente et compatible (même version de Minecraft, même
   * chargeur, stable), ou `null`. Jamais une version plus ancienne.
   */
  async newerVersion(
    modId: number,
    installed: {
      versionId: string;
      publishedAt: string | null;
      gameVersion: string;
      loader: string;
    },
  ): Promise<{ id: string; label: string; publishedAt: string } | null> {
    const params = new URLSearchParams({ pageSize: "50" });
    if (installed.gameVersion !== "") params.set("gameVersion", installed.gameVersion);
    const { data } = await this.client.call<{ data: CurseForgeFile[] }>(
      `/mods/${modId}/files?${params}`,
    );
    const since = installed.publishedAt ? Date.parse(installed.publishedAt) : Number.NaN;

    const best = data
      .filter((file) => !file.isServerPack && (file.releaseType ?? 1) === 1)
      .filter((file) => String(file.id) !== installed.versionId)
      .filter(
        (file) => installed.gameVersion === "" || file.gameVersions.includes(installed.gameVersion),
      )
      .filter((file) => {
        const loader = fileLoaderOf(file);
        return installed.loader === "" || loader === null || loader === installed.loader;
      })
      .filter((file) => Number.isNaN(since) || Date.parse(file.fileDate) > since)
      .sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate))[0];

    return best
      ? {
          id: String(best.id),
          label: `${best.displayName}${gameVersionOf(best) ? ` · ${gameVersionOf(best)}` : ""}`,
          publishedAt: best.fileDate,
        }
      : null;
  }

  private async batch<T>(path: string, field: string, ids: number[]): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += LOT) {
      const { data } = await this.client.call<{ data: T[] }>(path, {
        [field]: ids.slice(i, i + LOT),
      });
      out.push(...data);
    }
    return out;
  }
}

/**
 * Lit `manifest.json`, venu d'une archive tierce : donnée douteuse.
 *
 * `null` quand ce n'est pas un manifeste de modpack Minecraft. Le dossier de
 * surcharges doit être un chemin relatif sûr (ni `..`, ni absolu) : c'est
 * l'archive qui le nomme, et un `../` ferait déplacer autre chose que le pack.
 */
export function parseManifest(raw: string): CurseForgeManifest | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  const manifest = body as {
    manifestType?: unknown;
    name?: unknown;
    minecraft?: { version?: unknown; modLoaders?: unknown };
    files?: unknown;
    overrides?: unknown;
  };
  if (manifest.manifestType !== "minecraftModpack" || !Array.isArray(manifest.files)) return null;

  const loaders = Array.isArray(manifest.minecraft?.modLoaders)
    ? (manifest.minecraft.modLoaders as { id?: unknown; primary?: unknown }[])
    : [];
  const primary = loaders.find((l) => l.primary === true) ?? loaders[0];

  const overrides = typeof manifest.overrides === "string" ? manifest.overrides : "overrides";
  if (!cheminSur(overrides)) return null;

  const files: { projectID: number; fileID: number }[] = [];
  for (const entry of manifest.files as {
    projectID?: unknown;
    fileID?: unknown;
    required?: unknown;
  }[]) {
    if (entry.required === false) continue;
    if (!Number.isInteger(entry.projectID) || !Number.isInteger(entry.fileID)) continue;
    files.push({ projectID: entry.projectID as number, fileID: entry.fileID as number });
  }

  return {
    name: typeof manifest.name === "string" ? manifest.name : "Modpack",
    gameVersion: typeof manifest.minecraft?.version === "string" ? manifest.minecraft.version : "",
    loader: typeof primary?.id === "string" ? packLoaderOf(primary.id) : null,
    files,
    overrides,
  };
}

/** Version de Minecraft d'un fichier : la première entrée numérique. */
export function gameVersionOf(file: Pick<CurseForgeFile, "gameVersions">): string {
  return file.gameVersions.find((v) => /^\d/.test(v)) ?? "";
}

/** Chargeur d'un fichier, lu dans `gameVersions` (« Forge », « NeoForge », « Fabric »…). */
export function fileLoaderOf(file: Pick<CurseForgeFile, "gameVersions">): PackLoader | null {
  for (const value of file.gameVersions) {
    const loader = packLoaderOf(value);
    if (loader) return loader.loader;
  }
  return null;
}
