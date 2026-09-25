import type { MarketplaceProject, ReleaseDependency } from "@gamedashboard/contracts";
import type { Database } from "@gamedashboard/db";
import { ConflictException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WingsClientService } from "../wings/wings-client.service";
import type { CurseForgeClient } from "./curseforge.client";
import { toDependencies as curseforgeDependencies } from "./curseforge.client";
import { MarketplaceService } from "./marketplace.service";
import type { ModrinthClient } from "./modrinth.client";
import { toDependencies as modrinthDependencies } from "./modrinth.client";
import type { DetectedRuntime } from "./server-runtime";
import type { SpigetClient } from "./spiget.client";

/**
 * Dépendances obligatoires.
 *
 * Sans elles, installer un plugin qui en exige un autre (un module d'économie
 * sans Vault, un mod Fabric sans Fabric API) posait un fichier qui refusait
 * de se charger, et le serveur le disait au démarrage, dans la console.
 */

const SERVER = "22222222-2222-4222-8222-222222222222";
const RUNTIME: DetectedRuntime = {
  game: "minecraft",
  loader: "fabric",
  gameVersion: "1.21.1",
  directory: "/mods",
};

function projet(id: string, name: string, dependencies: ReleaseDependency[] = []) {
  const slug = id.split(":")[1];
  return {
    id,
    source: "modrinth",
    name,
    summary: "",
    author: "",
    downloads: 1,
    categories: [],
    releases: [
      {
        version: "1.0.0",
        gameVersions: ["1.21.1"],
        loaders: ["fabric"],
        publishedAt: "2026-01-01T00:00:00.000Z",
        downloadUrl: `https://cdn.modrinth.com/data/${slug}/versions/v1/${slug}.jar`,
        fileName: `${slug}.jar`,
        dependencies,
      },
    ],
  } satisfies MarketplaceProject;
}

function monter(catalogue: MarketplaceProject[], installes: string[] = []) {
  const daemon = { pullFile: vi.fn(async () => {}), deleteFiles: vi.fn(async () => {}) };
  const lignes = installes.map((projectId) => ({
    projectId,
    versionId: "1.0.0",
    installedAt: "2026-01-01T00:00:00.000Z",
    installedFiles: [`${projectId}.jar`],
  }));
  const db = {
    select: () => ({ from: () => ({ where: async () => lignes }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: async () => {} }) }),
  } as unknown as Database;
  const client = {
    project: vi.fn(async (id: string) => catalogue.find((p) => p.id === id) ?? null),
  };
  const svc = new MarketplaceService(
    db,
    daemon as unknown as WingsClientService,
    client as unknown as ModrinthClient,
    client as unknown as CurseForgeClient,
    client as unknown as SpigetClient,
  );
  vi.spyOn(svc as unknown as { runtimeOf: () => unknown }, "runtimeOf").mockResolvedValue(RUNTIME);
  const poses = () => daemon.pullFile.mock.calls.map((call) => (call as unknown[])[3]);
  return { svc, daemon, poses };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("installation : dépendances obligatoires", () => {
  it("pose les dépendances absentes avant l'extension, en profondeur", async () => {
    const { svc, poses } = monter([
      projet("modrinth:mod", "Mod", [{ projectId: "modrinth:lib", kind: "required" }]),
      projet("modrinth:lib", "Lib", [{ projectId: "modrinth:api", kind: "required" }]),
      projet("modrinth:api", "Fabric API"),
    ]);

    const fait = await svc.install(SERVER, "modrinth:mod");
    expect(poses()).toEqual(["api.jar", "lib.jar", "mod.jar"]);
    expect(fait.dependencies).toEqual([
      { name: "Fabric API", version: "1.0.0" },
      { name: "Lib", version: "1.0.0" },
    ]);
  });

  it("ne repose pas une dépendance déjà installée", async () => {
    const { svc, poses } = monter(
      [
        projet("modrinth:mod", "Mod", [{ projectId: "modrinth:api", kind: "required" }]),
        projet("modrinth:api", "Fabric API"),
      ],
      ["modrinth:api"],
    );

    await svc.install(SERVER, "modrinth:mod");
    expect(poses()).toEqual(["mod.jar"]);
  });

  it("refuse tout, sans rien télécharger, quand une dépendance est introuvable", async () => {
    const { svc, daemon } = monter([
      projet("modrinth:mod", "Mod", [{ projectId: "modrinth:absent", kind: "required" }]),
    ]);

    await expect(svc.install(SERVER, "modrinth:mod")).rejects.toBeInstanceOf(ConflictException);
    expect(daemon.pullFile).not.toHaveBeenCalled();
  });

  it("refuse une extension déclarée incompatible avec une extension installée", async () => {
    const { svc, daemon } = monter(
      [projet("modrinth:mod", "Mod", [{ projectId: "modrinth:rival", kind: "incompatible" }])],
      ["modrinth:rival"],
    );

    await expect(svc.install(SERVER, "modrinth:mod")).rejects.toThrow(/incompatible/);
    expect(daemon.pullFile).not.toHaveBeenCalled();
  });

  it("ne tourne pas en rond sur des dépendances croisées", async () => {
    const { svc, poses } = monter([
      projet("modrinth:mod", "Mod", [{ projectId: "modrinth:lib", kind: "required" }]),
      projet("modrinth:lib", "Lib", [{ projectId: "modrinth:mod", kind: "required" }]),
    ]);

    await svc.install(SERVER, "modrinth:mod");
    expect(poses()).toEqual(["lib.jar", "mod.jar"]);
  });
});

describe("lecture des dépendances dans les catalogues", () => {
  it("Modrinth : garde obligatoires et incompatibles, écarte le reste", () => {
    expect(
      modrinthDependencies([
        { project_id: "AAA", version_id: null, dependency_type: "required" },
        { project_id: "BBB", version_id: null, dependency_type: "optional" },
        { project_id: "CCC", version_id: null, dependency_type: "incompatible" },
        { project_id: "DDD", version_id: null, dependency_type: "embedded" },
        { project_id: null, version_id: "v1", dependency_type: "required" },
      ]),
    ).toEqual([
      { projectId: "modrinth:AAA", kind: "required" },
      { projectId: "modrinth:CCC", kind: "incompatible" },
    ]);
  });

  it("CurseForge : relation 3 obligatoire, 5 incompatible", () => {
    expect(
      curseforgeDependencies([
        { modId: 1, relationType: 3 },
        { modId: 2, relationType: 2 },
        { modId: 3, relationType: 5 },
      ]),
    ).toEqual([
      { projectId: "curseforge:1", kind: "required" },
      { projectId: "curseforge:3", kind: "incompatible" },
    ]);
  });
});
