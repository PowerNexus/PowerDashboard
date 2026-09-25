import {
  type PackLoader,
  type PackSource,
  packFitsServer,
  packLoaderOf,
} from "@gamedashboard/contracts";
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { WingsClientService } from "../wings/wings-client.service";
import {
  CurseForgePackService,
  fileLoaderOf,
  gameVersionOf,
  parseManifest,
} from "./curseforge-pack";
import { isTrustedDownload, ModpackSourceService } from "./modpack-source";
import { planifier, suiviApres } from "./pack-files";
import { PackWorkspace } from "./pack-workspace";
import type { DetectedRuntime } from "./server-runtime";

/**
 * Installation et mise à jour d'un modpack, Modrinth ou CurseForge.
 *
 * Deux temps, et la frontière entre eux est le premier octet écrit :
 *
 * 1. `prepare` interroge le catalogue et refuse tout ce qui peut l'être
 *    **avant** que le serveur soit arrêté : version d'un autre projet, archive
 *    hors des dépôts connus, chargeur qui ne convient pas à l'egg, pack
 *    CurseForge dont l'auteur interdit la distribution.
 * 2. `run` fait travailler le daemon : l'archive est tirée et ouverte dans un
 *    dossier de travail (`PackWorkspace`), ce que le pack pose est rassemblé,
 *    puis le plan (`planifier`) décide fichier par fichier ce qui est écrit,
 *    gardé ou retiré. Un refus découvert à l'ouverture de l'archive (index
 *    illisible, mod non distribuable dans un manifeste) laisse l'arborescence
 *    du serveur intacte : seul le dossier de travail a été écrit, et il part.
 */

/** Ce que l'installation retient du pack, pour le suivi en base. */
export interface PackRecord {
  source: PackSource;
  projectId: string;
  label: string;
  versionId: string;
  versionLabel: string;
  publishedAt: string | null;
  gameVersion: string;
  loader: string | null;
  files: Record<string, string>;
}

export interface PackOutcome {
  record: PackRecord;
  /** Fichiers écrits. */
  written: number;
  /** Fichiers que le pack pose mais qui n'ont pas pu l'être (téléchargement, déplacement). */
  missing: string[];
  /** Fichiers gardés : modifiés depuis l'installation précédente, ou au serveur. */
  kept: string[];
  /** Fichiers de la version précédente retirés. */
  removed: number;
  /** Ce qui reste à faire à la main, dit en clair (chargeur Forge, fichiers du client). */
  notice: string | null;
}

/** Une installation préparée : tout ce qui pouvait être refusé l'a été. */
export interface PreparedPack {
  source: PackSource;
  projectId: string;
  label: string;
  versionId: string;
  versionLabel: string;
  publishedAt: string | null;
  gameVersion: string;
  archive: { url: string; fileName: string };
  /** `server-pack` : archive prête ; `mrpack` et `manifest` : fichiers à tirer. */
  form: "mrpack" | "server-pack" | "manifest";
  /** Chargeur connu avant l'ouverture (fichier CurseForge), sinon lu dans l'archive. */
  loader: { loader: PackLoader; version: string } | null;
}

/** Ce que le pack pose, rassemblé depuis l'archive ouverte. */
interface Incoming {
  /** Destination → chemin dans le dossier de travail. */
  moves: Map<string, string>;
  /** Destination → adresse à faire tirer. */
  pulls: Map<string, string>;
  loader: { loader: PackLoader; version: string } | null;
  gameVersion: string;
  name: string | null;
  notices: string[];
}

/** Le chargeur de serveur à poser, résolu par l'appelant (`EngineService`). */
export type LoaderInstaller = (
  loader: { loader: PackLoader; version: string } | null,
  gameVersion: string,
) => Promise<string | null>;

@Injectable()
export class PackInstallerService {
  private readonly logger = new Logger(PackInstallerService.name);

  constructor(
    @Inject(WingsClientService) private readonly wings: WingsClientService,
    @Inject(ModpackSourceService) private readonly modrinth: ModpackSourceService,
    @Inject(CurseForgePackService) private readonly curseforge: CurseForgePackService,
  ) {}

  /** Refuse avant d'arrêter quoi que ce soit ; rend de quoi installer. */
  async prepare(
    optionId: string,
    versionId: string,
    runtime: DetectedRuntime,
  ): Promise<PreparedPack> {
    if (optionId.startsWith("curseforge-pack:")) {
      return this.prepareCurseForge(optionId, versionId, runtime);
    }
    return this.prepareModrinth(optionId, versionId, runtime);
  }

  private async prepareModrinth(
    optionId: string,
    versionId: string,
    runtime: DetectedRuntime,
  ): Promise<PreparedPack> {
    const projectId = optionId.slice("modpack:".length);
    const version = await this.modrinth.version(versionId);
    if (!version?.archive) {
      throw new NotFoundException("Cette version de modpack n'a pas d'archive.");
    }
    // Le couple vient du navigateur : une version d'un autre projet ferait
    // installer autre chose que ce que l'écran annonçait, et fausserait le suivi.
    if (projectId !== "" && version.projectId !== projectId) {
      throw new NotFoundException("Cette version n'appartient pas à ce modpack.");
    }
    this.assertTrusted(version.archive.url);

    const loaders = version.loaders
      .map((value) => packLoaderOf(value))
      .filter((value): value is NonNullable<typeof value> => value !== null);
    if (loaders.length > 0 && !loaders.some((l) => packFitsServer(l.loader, runtime.loader))) {
      throw new ConflictException(refusChargeur(loaders[0]?.loader ?? "", runtime.loader));
    }

    return {
      source: "modrinth",
      projectId: version.projectId,
      label: "",
      versionId: version.id,
      versionLabel: version.label,
      publishedAt: version.publishedAt,
      gameVersion: version.gameVersion,
      archive: version.archive,
      form: "mrpack",
      loader: null,
    };
  }

  private async prepareCurseForge(
    optionId: string,
    versionId: string,
    runtime: DetectedRuntime,
  ): Promise<PreparedPack> {
    const modId = Number(optionId.slice("curseforge-pack:".length));
    const fileId = Number(versionId);
    if (!Number.isInteger(modId) || !Number.isInteger(fileId)) {
      throw new NotFoundException("Modpack CurseForge inconnu.");
    }
    const file = await this.curseforge.file(modId, fileId);
    if (!file || file.isServerPack) {
      throw new NotFoundException("Cette version n'appartient pas à ce modpack.");
    }

    const family = fileLoaderOf(file);
    if (family && !packFitsServer(family, runtime.loader)) {
      throw new ConflictException(refusChargeur(family, runtime.loader));
    }

    const serverPack = await this.curseforge.serverPackOf(file);
    const archive = serverPack ?? file;
    if (!archive.downloadUrl) {
      throw new ConflictException(
        "L'auteur de ce modpack refuse la distribution de ses fichiers par l'API CurseForge : le panel ne peut pas le télécharger. " +
          "Installez-le par SFTP depuis le site de CurseForge, ou choisissez une version qui publie un pack serveur.",
      );
    }
    this.assertTrusted(archive.downloadUrl);

    return {
      source: "curseforge",
      projectId: String(modId),
      label: await this.curseforge.projectName(modId).catch(() => ""),
      versionId: String(file.id),
      versionLabel: `${file.displayName}${gameVersionOf(file) ? ` · ${gameVersionOf(file)}` : ""}`,
      publishedAt: file.fileDate,
      gameVersion: gameVersionOf(file),
      archive: { url: archive.downloadUrl, fileName: archive.fileName },
      form: serverPack ? "server-pack" : "manifest",
      loader: family ? { loader: family, version: "" } : null,
    };
  }

  /**
   * Pose le pack. `previous` : fichiers suivis de l'installation précédente
   * d'un pack sur ce serveur, vides pour une première.
   */
  async run(
    serverId: string,
    prepared: PreparedPack,
    runtime: DetectedRuntime,
    previous: Record<string, string>,
    installLoader: LoaderInstaller,
  ): Promise<PackOutcome> {
    const ws = new PackWorkspace(this.wings, serverId);
    await ws.reset();
    try {
      await ws.unpack(prepared.archive.url, prepared.archive.fileName);
      const incoming = await this.collect(ws, prepared, runtime);

      const paths = [...incoming.moves.keys(), ...incoming.pulls.keys()];
      const onDisk = await ws.fingerprints([...paths, ...Object.keys(previous)]);
      const plan = planifier(previous, onDisk, paths);
      const toWrite = new Set(plan.ecrire);

      await ws.remove(plan.retirer);
      const moves = [...incoming.moves]
        .filter(([to]) => toWrite.has(to))
        .map(([to, from]) => ({ from, to }));
      const failedMoves = await ws.move(
        moves,
        moves.map((move) => move.to).filter((to) => onDisk[to] !== undefined),
      );
      const failedPulls = await ws.pull(
        [...incoming.pulls]
          .filter(([path]) => toWrite.has(path))
          .map(([path, url]) => ({ path, url })),
      );

      const gameVersion = incoming.gameVersion || prepared.gameVersion;
      const loaderNotice = await installLoader(incoming.loader, gameVersion);

      const missing = [...failedMoves, ...failedPulls];
      const written = plan.ecrire.filter((path) => !missing.includes(path));
      const ecrits = await ws.fingerprints(written);
      const loader = incoming.loader;

      return {
        record: {
          source: prepared.source,
          projectId: prepared.projectId,
          label: prepared.label || incoming.name || "Modpack",
          versionId: prepared.versionId,
          versionLabel: prepared.versionLabel,
          publishedAt: prepared.publishedAt,
          gameVersion,
          loader: loader ? `${loader.loader} ${loader.version}`.trim() : null,
          files: suiviApres(previous, plan, ecrits),
        },
        written: written.length,
        missing,
        kept: plan.garder,
        removed: plan.retirer.length,
        notice: [...incoming.notices, loaderNotice].filter(Boolean).join(" ") || null,
      };
    } finally {
      await ws.cleanup();
    }
  }

  /** Rassemble ce que l'archive ouverte demande de poser, selon sa forme. */
  private async collect(
    ws: PackWorkspace,
    prepared: PreparedPack,
    runtime: DetectedRuntime,
  ): Promise<Incoming> {
    if (prepared.form === "mrpack") return this.collectMrpack(ws, runtime);
    if (prepared.form === "manifest") return this.collectManifest(ws, runtime);

    // Pack serveur : tout son contenu, à la racine.
    const base = await ws.base();
    const moves = new Map<string, string>();
    for (const file of await ws.tree(base)) {
      moves.set(file.path, base === "" ? file.path : `${base}/${file.path}`);
    }
    return {
      moves,
      pulls: new Map(),
      loader: prepared.loader,
      gameVersion: prepared.gameVersion,
      name: null,
      notices: [],
    };
  }

  private async collectMrpack(ws: PackWorkspace, runtime: DetectedRuntime): Promise<Incoming> {
    const raw = await ws.read("modrinth.index.json");
    const index = raw ? this.modrinth.parseIndex(raw) : null;
    if (!index) {
      throw new ConflictException(
        "L'archive ne contient pas d'index lisible : rien n'a été modifié sur le serveur.",
      );
    }
    if (index.loader && !packFitsServer(index.loader.loader, runtime.loader)) {
      throw new ConflictException(refusChargeur(index.loader.loader, runtime.loader));
    }

    // `server-overrides` après `overrides` : la spécification le fait primer.
    const moves = new Map<string, string>();
    for (const folder of ["overrides", "server-overrides"]) {
      for (const file of await ws.tree(folder)) moves.set(file.path, `${folder}/${file.path}`);
    }
    // Les surcharges passent après les téléchargements dans la spécification :
    // un fichier présent des deux côtés est celui des surcharges.
    const pulls = new Map<string, string>();
    for (const file of index.files) {
      const url = file.downloads[0];
      if (url && !moves.has(file.path)) pulls.set(file.path, url);
    }
    return {
      moves,
      pulls,
      loader: index.loader,
      gameVersion: index.gameVersion,
      name: index.name,
      notices: [],
    };
  }

  private async collectManifest(ws: PackWorkspace, runtime: DetectedRuntime): Promise<Incoming> {
    const base = (await ws.read("manifest.json")) === null ? await ws.base() : "";
    const raw = await ws.read(base === "" ? "manifest.json" : `${base}/manifest.json`);
    const manifest = raw ? parseManifest(raw) : null;
    if (!manifest) {
      throw new ConflictException(
        "L'archive ne contient pas de manifest.json lisible : rien n'a été modifié sur le serveur.",
      );
    }
    if (manifest.loader && !packFitsServer(manifest.loader.loader, runtime.loader)) {
      throw new ConflictException(refusChargeur(manifest.loader.loader, runtime.loader));
    }

    const resolved = await this.curseforge.resolve(manifest);
    if (resolved.blocked.length > 0) {
      throw new ConflictException(
        `${resolved.blocked.length} fichier(s) de ce pack ne peuvent pas être téléchargés par le panel : ` +
          `leur auteur refuse la distribution par l'API CurseForge (${liste(resolved.blocked)}). ` +
          "Rien n'a été modifié sur le serveur. Choisissez une version qui publie un pack serveur, ou installez le pack par SFTP.",
      );
    }
    if (resolved.unusable.length > 0) {
      throw new ConflictException(
        `${resolved.unusable.length} fichier(s) de ce pack sont introuvables ou refusés (${liste(resolved.unusable)}). ` +
          "Rien n'a été modifié sur le serveur.",
      );
    }

    const folder = base === "" ? manifest.overrides : `${base}/${manifest.overrides}`;
    const moves = new Map<string, string>();
    for (const file of await ws.tree(folder)) moves.set(file.path, `${folder}/${file.path}`);
    const pulls = new Map(
      resolved.pulls.filter((pull) => !moves.has(pull.path)).map((pull) => [pull.path, pull.url]),
    );

    return {
      moves,
      pulls,
      loader: manifest.loader,
      gameVersion: manifest.gameVersion,
      name: manifest.name,
      notices:
        resolved.clientOnly > 0
          ? [
              `${resolved.clientOnly} fichier(s) réservés au client (packs de ressources, shaders) n'ont pas été posés.`,
            ]
          : [],
    };
  }

  private assertTrusted(url: string): void {
    // L'adresse vient de l'API du catalogue, et le daemon la suivrait depuis
    // le réseau du node sans regarder.
    if (!isTrustedDownload(url)) {
      this.logger.warn(`Archive de modpack refusée : ${url}`);
      throw new ConflictException(
        "L'archive de ce modpack est servie depuis une adresse hors des dépôts connus. Installation refusée.",
      );
    }
  }
}

function refusChargeur(packLoader: string, serverLoader: string): string {
  return `Ce modpack demande ${packLoader || "un autre chargeur"}, et ce serveur fait tourner ${serverLoader}. Changez d'abord l'egg du serveur : le panel ne bascule pas un chargeur de mods à l'aveugle.`;
}

/** Une liste lisible, bornée : un message d'erreur n'est pas un inventaire. */
function liste(items: string[]): string {
  const shown = items.slice(0, 8).join(", ");
  return items.length > 8 ? `${shown} et ${items.length - 8} autre(s)` : shown;
}
