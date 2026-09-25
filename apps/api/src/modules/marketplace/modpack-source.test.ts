import { Logger } from "@nestjs/common";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ModpackSourceService } from "./modpack-source";

/** Réponses simulées au format documenté de l'API Modrinth (`/v2`). */

beforeAll(() => {
  Logger.overrideLogger(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function version(id: string, date: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    project_id: "pack",
    name: id,
    version_number: id,
    game_versions: ["1.21.1"],
    loaders: ["fabric"],
    version_type: "release",
    date_published: date,
    files: [
      {
        url: `https://cdn.modrinth.com/data/pack/${id}.mrpack`,
        filename: `${id}.mrpack`,
        primary: true,
      },
    ],
    ...extra,
  };
}

describe("index d'un .mrpack", () => {
  it("lit la version de jeu et le chargeur dans les dépendances", () => {
    const index = new ModpackSourceService().parseIndex(
      JSON.stringify({
        name: "Pack",
        versionId: "1.0",
        files: [],
        dependencies: { minecraft: "1.21.1", "fabric-loader": "0.16.10" },
      }),
    );
    expect(index).toMatchObject({
      gameVersion: "1.21.1",
      loader: { loader: "fabric", version: "0.16.10" },
    });
  });

  it("écarte les mods du seul client et les chemins qui sortent du serveur", () => {
    const index = new ModpackSourceService().parseIndex(
      JSON.stringify({
        files: [
          {
            path: "mods/a.jar",
            downloads: ["https://cdn.modrinth.com/a.jar"],
            env: { server: "required" },
          },
          {
            path: "mods/iris.jar",
            downloads: ["https://cdn.modrinth.com/i.jar"],
            env: { server: "unsupported" },
          },
          { path: "../x.jar", downloads: ["https://cdn.modrinth.com/x.jar"] },
          { path: "mods/b.jar", downloads: ["https://evil.example/b.jar"] },
        ],
      }),
    );
    expect(index?.files.map((f) => f.path)).toEqual(["mods/a.jar"]);
  });
});

describe("veille d'un modpack Modrinth", () => {
  it("propose la plus récente stable pour la même version de jeu et le même chargeur", async () => {
    const fetch = vi.fn(async (_url: string) =>
      Response.json([
        version("v3", "2026-04-01T00:00:00Z", { version_type: "beta" }),
        version("v2", "2026-03-01T00:00:00Z"),
        version("v4", "2026-05-01T00:00:00Z", { game_versions: ["1.21.4"] }),
        version("v1", "2026-02-01T00:00:00Z"),
        version("v0", "2026-01-01T00:00:00Z"),
      ]),
    );
    vi.stubGlobal("fetch", fetch);

    const newer = await new ModpackSourceService().newerVersion("pack", {
      versionId: "v1",
      publishedAt: "2026-02-01T00:00:00Z",
      gameVersion: "1.21.1",
      loader: "fabric",
    });

    expect(newer?.id).toBe("v2");
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/v2/project/pack/version");
    expect(url.searchParams.get("game_versions")).toBe('["1.21.1"]');
    expect(url.searchParams.get("loaders")).toBe('["fabric"]');
  });

  it("rien de plus récent : rien à proposer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([version("v1", "2026-02-01T00:00:00Z")])),
    );
    const newer = await new ModpackSourceService().newerVersion("pack", {
      versionId: "v1",
      publishedAt: "2026-02-01T00:00:00Z",
      gameVersion: "1.21.1",
      loader: "fabric",
    });
    expect(newer).toBeNull();
  });
});
