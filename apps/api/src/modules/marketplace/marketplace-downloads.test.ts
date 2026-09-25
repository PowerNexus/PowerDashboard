import type {
  MarketplaceProject,
  MarketplaceSource,
  ProjectRelease,
} from "@gamedashboard/contracts";
import type { Database } from "@gamedashboard/db";
import { ConflictException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WingsClientService } from "../wings/wings-client.service";
import type { CurseForgeClient } from "./curseforge.client";
import type { CurseForgePackService } from "./curseforge-pack";
import { EngineService } from "./engine.service";
import type { EngineSourcesService } from "./engine-sources";
import type { EulaService } from "./eula.service";
import { MarketplaceService } from "./marketplace.service";
import type { ModpackSourceService } from "./modpack-source";
import type { ModrinthClient } from "./modrinth.client";
import { PackInstallerService } from "./pack-installer.service";
import type { DetectedRuntime } from "./server-runtime";
import type { SpigetClient } from "./spiget.client";

/**
 * Adresses de téléchargement rendues par Modrinth et CurseForge (NC-47).
 *
 * Le panel les transmettait au daemon telles quelles : Wings télécharge sans
 * regarder, depuis le réseau du node. Une réponse falsifiée — ou un projet
 * piégé — faisait de lui un relais vers `169.254.169.254` ou le réseau
 * d'administration. Seul l'index d'un `.mrpack` passait par la liste d'hôtes
 * de `modpack-source.ts` ; l'extension et l'archive du pack, non.
 */

const SERVER = "22222222-2222-4222-8222-222222222222";
const METADONNEES = "http://169.254.169.254/latest/meta-data/";
const RUNTIME: DetectedRuntime = {
  game: "minecraft",
  loader: "paper",
  gameVersion: "1.21.1",
  directory: "/plugins",
};

function wings() {
  return {
    pullFile: vi.fn(async () => {}),
    deleteFiles: vi.fn(async () => {}),
    power: vi.fn(async () => {}),
    decompressFile: vi.fn(async () => {}),
    readFile: vi.fn(async () => ""),
  };
}

function projet(source: MarketplaceSource, downloadUrl: string): MarketplaceProject {
  return {
    id: `${source}:essentials`,
    source,
    name: "Essentials",
    summary: "",
    author: "auteur",
    downloads: 1,
    categories: [],
    releases: [
      {
        version: "2.21.0",
        gameVersions: ["1.21.1"],
        loaders: ["paper"],
        publishedAt: "2026-01-01T00:00:00.000Z",
        downloadUrl,
        fileName: "essentials.jar",
      },
    ],
  };
}

/** Le catalogue d'extensions, sa base simulée : rien d'installé, écriture acceptée. */
function catalogue(found: MarketplaceProject) {
  const daemon = wings();
  const db = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: async () => {} }) }),
  } as unknown as Database;
  const client = { project: vi.fn(async () => found) };
  const svc = new MarketplaceService(
    db,
    daemon as unknown as WingsClientService,
    client as unknown as ModrinthClient,
    client as unknown as CurseForgeClient,
    client as unknown as SpigetClient,
  );
  vi.spyOn(svc as unknown as { runtimeOf: () => unknown }, "runtimeOf").mockResolvedValue(RUNTIME);
  return { svc, daemon };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extension : adresse rendue par le catalogue", () => {
  it.each(["modrinth", "curseforge"] as const)(
    "%s : refuse une adresse hors des dépôts connus, avant tout appel au daemon",
    async (source) => {
      const { svc, daemon } = catalogue(projet(source, METADONNEES));

      await expect(svc.install(SERVER, `${source}:essentials`)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(daemon.pullFile).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["modrinth", "https://cdn.modrinth.com/data/abc/versions/def/essentials.jar"],
    ["curseforge", "https://edge.forgecdn.net/files/1234/567/essentials.jar"],
  ] as const)("%s : laisse passer son propre dépôt", async (source, url) => {
    const { svc, daemon } = catalogue(projet(source, url));

    await svc.install(SERVER, `${source}:essentials`);
    expect(daemon.pullFile).toHaveBeenCalledWith(SERVER, "/plugins", url, "essentials.jar");
  });

  it("ne touche pas à SpigotMC, dont le panel compose l'adresse lui-même", async () => {
    // `spiget.client.ts` écrit `https://api.spiget.org/v2/resources/<id>/download` :
    // l'adresse ne vient pas d'une réponse, elle n'est pas dans le périmètre.
    const url = "https://api.spiget.org/v2/resources/9089/download";
    const { svc, daemon } = catalogue(projet("spigot", url));

    await svc.install(SERVER, "spigot:essentials");
    expect(daemon.pullFile).toHaveBeenCalledWith(SERVER, "/plugins", url, "essentials.jar");
  });
});

describe("modpack : archive rendue par Modrinth", () => {
  function moteur(archiveUrl: string) {
    const daemon = { ...wings(), listDirectory: vi.fn(async () => []) };
    const db = {
      update: () => ({ set: () => ({ where: async () => {} }) }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    } as unknown as Database;
    const packs = {
      version: vi.fn(async () => ({
        id: "v1",
        projectId: "pack",
        label: "1.0 · 1.21.1",
        gameVersion: "",
        loaders: ["fabric"],
        publishedAt: "2026-01-01T00:00:00Z",
        archive: { url: archiveUrl, fileName: "pack.mrpack" },
      })),
      parseIndex: vi.fn(() => null),
    };
    const installer = new PackInstallerService(
      daemon as unknown as WingsClientService,
      packs as unknown as ModpackSourceService,
      {} as CurseForgePackService,
    );
    const svc = new EngineService(
      db,
      daemon as unknown as WingsClientService,
      {} as EngineSourcesService,
      packs as unknown as ModpackSourceService,
      { reset: vi.fn(async () => false) } as unknown as EulaService,
      installer,
      {} as CurseForgePackService,
    );
    vi.spyOn(svc as unknown as { runtimeOf: () => unknown }, "runtimeOf").mockResolvedValue({
      ...RUNTIME,
      loader: "fabric",
      directory: "/mods",
    });
    return { svc, daemon };
  }

  it("refuse une archive hors des dépôts connus, avant tout téléchargement", async () => {
    const { svc, daemon } = moteur(METADONNEES);

    const refus = svc.install(SERVER, "modpack:pack", "v1");
    await expect(refus).rejects.toBeInstanceOf(ConflictException);
    // Le refus nomme l'adresse : un index absent, plus loin, lèverait aussi un
    // conflit, mais après avoir fait télécharger l'archive.
    await expect(refus).rejects.toThrow(/adresse/);
    expect(daemon.pullFile).not.toHaveBeenCalled();
    // Refusé avant l'arrêt : le serveur reste tel qu'on l'a trouvé.
    expect(daemon.power).not.toHaveBeenCalled();
  });

  it("laisse passer l'archive servie par Modrinth, tirée dans le dossier de travail", async () => {
    const url = "https://cdn.modrinth.com/data/abc/versions/v1/pack.mrpack";
    const { svc, daemon } = moteur(url);

    // L'index est illisible ici : l'installation s'arrête plus loin, et ce
    // n'est pas le sujet. Seul compte ce qui a été demandé au daemon.
    await svc.install(SERVER, "modpack:pack", "v1").catch(() => undefined);
    expect(daemon.pullFile).toHaveBeenCalledWith(
      SERVER,
      "/.gamedashboard-pack",
      url,
      "pack.mrpack",
    );
  });
});

describe("extension : version choisie", () => {
  const MODRINTH = "https://cdn.modrinth.com/data/abc/versions";

  function historique(): MarketplaceProject {
    const base = projet("modrinth", `${MODRINTH}/new/essentials-2.jar`);
    const recente = base.releases[0] as ProjectRelease;
    return {
      ...base,
      releases: [
        { ...recente, version: "2.21.0", fileName: "essentials-2.jar" },
        {
          ...recente,
          version: "2.20.0",
          publishedAt: "2025-06-01T00:00:00.000Z",
          downloadUrl: `${MODRINTH}/old/essentials-1.jar`,
          fileName: "essentials-1.jar",
        },
      ],
    };
  }

  it("télécharge la publication demandée, même antérieure à la plus récente", async () => {
    const { svc, daemon } = catalogue(historique());

    const fait = await svc.install(SERVER, "modrinth:essentials", "2.20.0");
    expect(fait).toMatchObject({ version: "2.20.0", fileName: "essentials-1.jar" });
    expect(daemon.pullFile).toHaveBeenCalledWith(
      SERVER,
      "/plugins",
      `${MODRINTH}/old/essentials-1.jar`,
      "essentials-1.jar",
    );
  });

  it("refuse une version absente du catalogue, sans rien demander au daemon", async () => {
    const { svc, daemon } = catalogue(historique());

    await expect(svc.install(SERVER, "modrinth:essentials", "9.9.9")).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(daemon.pullFile).not.toHaveBeenCalled();
  });
});
