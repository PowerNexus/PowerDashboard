import { describe, expect, it, vi } from "vitest";
import type { CurseForgeClient } from "./curseforge.client";
import { CurseForgePackService, fileLoaderOf, parseManifest } from "./curseforge-pack";

/** Réponses simulées au format documenté de l'API CurseForge (`/v1`). */

function manifeste(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    manifestType: "minecraftModpack",
    manifestVersion: 1,
    name: "All the Mods",
    minecraft: { version: "1.20.1", modLoaders: [{ id: "forge-47.2.0", primary: true }] },
    files: [
      { projectID: 1, fileID: 11, required: true },
      { projectID: 2, fileID: 22, required: false },
    ],
    overrides: "overrides",
    ...extra,
  });
}

describe("manifest.json d'un modpack CurseForge", () => {
  it("lit la version, le chargeur principal et les seuls fichiers obligatoires", () => {
    expect(parseManifest(manifeste())).toEqual({
      name: "All the Mods",
      gameVersion: "1.20.1",
      loader: { loader: "forge", version: "47.2.0" },
      files: [{ projectID: 1, fileID: 11 }],
      overrides: "overrides",
    });
  });

  it("refuse un dossier de surcharges qui sortirait de l'archive", () => {
    expect(parseManifest(manifeste({ overrides: "../../" }))).toBeNull();
    expect(parseManifest(manifeste({ overrides: "/etc" }))).toBeNull();
  });

  it("refuse ce qui n'est pas un manifeste de modpack Minecraft", () => {
    expect(parseManifest("pas du json")).toBeNull();
    expect(parseManifest(JSON.stringify({ manifestType: "autre", files: [] }))).toBeNull();
  });

  it("lit le chargeur d'un fichier dans ses versions de jeu", () => {
    expect(fileLoaderOf({ gameVersions: ["1.20.1", "NeoForge"] })).toBe("neoforge");
    expect(fileLoaderOf({ gameVersions: ["1.20.1"] })).toBeNull();
  });
});

describe("veille d'un modpack CurseForge", () => {
  const fichier = (id: number, date: string, extra: Record<string, unknown> = {}) => ({
    id,
    modId: 42,
    displayName: `Pack ${id}`,
    fileName: `pack-${id}.zip`,
    downloadUrl: `https://edge.forgecdn.net/files/${id}/pack.zip`,
    fileDate: date,
    releaseType: 1,
    gameVersions: ["1.20.1", "Forge"],
    ...extra,
  });

  function service(files: unknown[]) {
    const call = vi.fn(async () => ({ data: files }));
    return {
      svc: new CurseForgePackService({ call } as unknown as CurseForgeClient),
      call,
    };
  }

  const installe = {
    versionId: "100",
    publishedAt: "2026-02-01T00:00:00Z",
    gameVersion: "1.20.1",
    loader: "forge",
  };

  it("propose la plus récente stable, même version de jeu, même chargeur", async () => {
    const { svc, call } = service([
      fichier(100, "2026-02-01T00:00:00Z"),
      fichier(101, "2026-03-01T00:00:00Z"),
      fichier(102, "2026-04-01T00:00:00Z", { releaseType: 2 }),
      fichier(103, "2026-05-01T00:00:00Z", { gameVersions: ["1.21.1", "Forge"] }),
      fichier(104, "2026-05-02T00:00:00Z", { gameVersions: ["1.20.1", "Fabric"] }),
      fichier(105, "2026-06-01T00:00:00Z", { isServerPack: true }),
    ]);

    expect(await svc.newerVersion(42, installe)).toEqual({
      id: "101",
      label: "Pack 101 · 1.20.1",
      publishedAt: "2026-03-01T00:00:00Z",
    });
    expect(call).toHaveBeenCalledWith("/mods/42/files?pageSize=50&gameVersion=1.20.1");
  });

  it("ne propose jamais une version plus ancienne", async () => {
    const { svc } = service([
      fichier(99, "2026-01-01T00:00:00Z"),
      fichier(100, "2026-02-01T00:00:00Z"),
    ]);
    expect(await svc.newerVersion(42, installe)).toBeNull();
  });
});
