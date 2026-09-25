import type { MarketplaceProject } from "@gamedashboard/contracts";
import { type Database, marketplaceInstalls } from "@gamedashboard/db";
import { Logger } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedLocation, seedNode, seedServer, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import type { WingsClientService } from "../wings/wings-client.service";
import type { CurseForgeClient } from "./curseforge.client";
import { MarketplaceService } from "./marketplace.service";
import type { ModrinthClient } from "./modrinth.client";
import type { DetectedRuntime } from "./server-runtime";
import type { SpigetClient } from "./spiget.client";

/**
 * Veille des mises à jour et liste des extensions installées.
 *
 * Avant elle, une mise à jour ne se voyait que si l'extension sortait dans la
 * recherche en cours : un plugin qu'on ne cherchait plus prenait du retard en
 * silence. La veille range le résultat en base, la liste le montre.
 */

const RUNTIME: DetectedRuntime = {
  game: "minecraft",
  loader: "paper",
  gameVersion: "1.21.1",
  directory: "/plugins",
};
const CDN = "https://cdn.modrinth.com/data/abc/versions";

function projet(versions: string[]): MarketplaceProject {
  return {
    id: "modrinth:essentials",
    source: "modrinth",
    name: "EssentialsX",
    summary: "",
    author: "auteur",
    downloads: 1,
    categories: [],
    releases: versions.map((version, index) => ({
      version,
      gameVersions: ["1.21.1"],
      loaders: ["paper"],
      publishedAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
      downloadUrl: `${CDN}/${version}/essentials-${version}.jar`,
      fileName: `essentials-${version}.jar`,
    })),
  };
}

describe.skipIf(!HAS_DATABASE)("veille des mises à jour du marketplace (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let serverId: string;
  let userId: string;
  let catalogue: MarketplaceProject;
  let service: MarketplaceService;
  const lire = vi.fn(async () => catalogue);

  beforeAll(async () => {
    Logger.overrideLogger(false);
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(
      sql.raw(
        "truncate table marketplace_installs, servers, allocations, eggs, nests, nodes, locations, users cascade",
      ),
    );
    const nodeId = await seedNode(db, { locationId: await seedLocation(db) });
    userId = await seedUser(db);
    serverId = await seedServer(db, { nodeId, ownerId: userId });
    catalogue = projet(["2.20.0", "2.21.0"]);
    const client = { project: lire };
    service = new MarketplaceService(
      db,
      {
        pullFile: vi.fn(async () => {}),
        deleteFiles: vi.fn(async () => {}),
      } as unknown as WingsClientService,
      client as unknown as ModrinthClient,
      client as unknown as CurseForgeClient,
      client as unknown as SpigetClient,
    );
    vi.spyOn(service as unknown as { runtimeOf: () => unknown }, "runtimeOf").mockResolvedValue(
      RUNTIME,
    );
  });

  afterEach(() => {
    lire.mockClear();
  });

  it("garde le nom, l'auteur de l'installation et l'absence de mise à jour", async () => {
    await service.install(serverId, "modrinth:essentials", undefined, userId);

    const [ligne] = await db.select().from(marketplaceInstalls);
    expect(ligne).toMatchObject({ name: "EssentialsX", versionId: "2.21.0", installedBy: userId });
    expect(ligne?.latestVersion).toBeNull();
    expect(ligne?.checkedAt).not.toBeNull();
  });

  it("après un retour en arrière, connaît aussitôt la version plus récente", async () => {
    await service.install(serverId, "modrinth:essentials", "2.20.0", userId);

    expect(await service.installed(serverId)).toMatchObject([
      { name: "EssentialsX", version: "2.20.0", latestVersion: "2.21.0" },
    ]);
  });

  it("signale une publication parue depuis, une seule fois", async () => {
    await service.install(serverId, "modrinth:essentials", undefined, userId);
    catalogue = projet(["2.20.0", "2.21.0", "2.22.0"]);

    // `0 seconds` : tout ce qui a été vérifié avant maintenant est dû.
    const premier = await service.checkUpdates(100, "0 seconds");
    expect(premier.get(serverId)).toEqual([{ name: "EssentialsX", version: "2.22.0" }]);
    expect(await service.installed(serverId)).toMatchObject([{ latestVersion: "2.22.0" }]);

    const second = await service.checkUpdates(100, "0 seconds");
    expect(second.size).toBe(0);
  });

  it("ne revérifie pas une installation trop récente", async () => {
    await service.install(serverId, "modrinth:essentials", undefined, userId);
    lire.mockClear();

    await service.checkUpdates(100, "24 hours");
    expect(lire).not.toHaveBeenCalled();
  });

  it("une source en panne n'efface pas une mise à jour déjà connue", async () => {
    await service.install(serverId, "modrinth:essentials", "2.20.0", userId);
    lire.mockRejectedValueOnce(new Error("Modrinth indisponible"));

    await service.checkUpdates(100, "0 seconds");
    const [ligne] = await db
      .select()
      .from(marketplaceInstalls)
      .where(eq(marketplaceInstalls.serverId, serverId));
    expect(ligne?.latestVersion).toBe("2.21.0");
  });
});
