import { type Database, serverEngines, servers } from "@gamedashboard/db";
import { Logger } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedLocation, seedNode, seedServer, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import type { NotificationsService } from "../notifications/notifications.service";
import { RemoteServerService } from "../remote/remote-server.service";
import type { WebhookEmitterService } from "../webhooks/webhook-emitter.service";
import type { WingsClientService } from "../wings/wings-client.service";
import type { CurseForgePackService } from "./curseforge-pack";
import { EngineService } from "./engine.service";
import type { EngineSourcesService } from "./engine-sources";
import type { EulaService } from "./eula.service";
import type { ModpackSourceService } from "./modpack-source";
import type { PackInstallerService, PackOutcome, PreparedPack } from "./pack-installer.service";
import type { DetectedRuntime } from "./server-runtime";

/**
 * Suivi du moteur installé.
 *
 * `EngineState.current` valait toujours `null` : l'écran ne pouvait dire ni
 * ce que le panel avait posé, ni qu'un modpack avait une version plus récente.
 */

const FABRIC: DetectedRuntime = {
  game: "minecraft",
  loader: "fabric",
  gameVersion: "1.21.1",
  directory: "/mods",
};

const PREPARED: PreparedPack = {
  source: "modrinth",
  projectId: "pack",
  label: "",
  versionId: "v1",
  versionLabel: "1.0 · 1.21.1",
  publishedAt: "2026-01-01T00:00:00.000Z",
  gameVersion: "1.21.1",
  archive: { url: "https://cdn.modrinth.com/data/pack/v1.mrpack", fileName: "v1.mrpack" },
  form: "mrpack",
  loader: null,
};

function outcome(versionId: string, files: Record<string, string>): PackOutcome {
  return {
    record: {
      source: "modrinth",
      projectId: "pack",
      label: "Pack de test",
      versionId,
      versionLabel: `${versionId} · 1.21.1`,
      publishedAt: "2026-01-01T00:00:00.000Z",
      gameVersion: "1.21.1",
      loader: "fabric 0.16.10",
      files,
    },
    written: Object.keys(files).length,
    missing: [],
    kept: [],
    removed: 0,
    notice: null,
  };
}

describe.skipIf(!HAS_DATABASE)("suivi du moteur installé (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let serverId: string;
  let userId: string;
  let service: EngineService;
  const events: string[] = [];
  const wings = {
    power: vi.fn(async () => {
      events.push("stop");
    }),
    pullFile: vi.fn(async () => {}),
    deleteFiles: vi.fn(async () => {}),
    renameFile: vi.fn(async () => {}),
    syncServer: vi.fn(async () => {}),
  };
  const installer = {
    prepare: vi.fn(async () => PREPARED),
    run: vi.fn(async () => {
      events.push("run");
      return outcome("v1", { "mods/a.jar": "10:t1", "config/a.toml": "3:t1" });
    }),
  };
  const packs = { newerVersion: vi.fn(), search: vi.fn(async () => []) };
  const sources = {
    resolve: vi.fn(async () => ({
      url: "https://fill.papermc.io/paper.jar",
      fileName: "paper.jar",
    })),
    labelOf: vi.fn(() => "Paper"),
    options: vi.fn(async () => []),
  };

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
        "truncate table server_engines, servers, allocations, eggs, nests, nodes, locations, users cascade",
      ),
    );
    const nodeId = await seedNode(db, { locationId: await seedLocation(db) });
    userId = await seedUser(db);
    serverId = await seedServer(db, { nodeId, ownerId: userId });
    events.length = 0;
    vi.clearAllMocks();

    service = new EngineService(
      db,
      wings as unknown as WingsClientService,
      sources as unknown as EngineSourcesService,
      packs as unknown as ModpackSourceService,
      { reset: vi.fn(async () => false) } as unknown as EulaService,
      installer as unknown as PackInstallerService,
      { search: vi.fn(async () => []), newerVersion: vi.fn() } as unknown as CurseForgePackService,
    );
    const priv = service as unknown as Record<string, () => unknown>;
    vi.spyOn(priv, "runtimeOf" as never).mockResolvedValue(FABRIC as never);
    vi.spyOn(priv, "runtimeImageFor" as never).mockResolvedValue(null as never);
    vi.spyOn(priv, "jarNameOf" as never).mockResolvedValue("server.jar" as never);
  });

  it("retient le modpack installé, et l'écran le dit", async () => {
    await service.install(serverId, "modpack:pack", "v1", { installedBy: userId });

    const current = await service.current(serverId);
    expect(current).toMatchObject({
      optionId: "modpack:pack",
      kind: "pack",
      label: "Pack de test",
      versionId: "v1",
      loader: "fabric 0.16.10",
      pack: { source: "modrinth", projectId: "pack" },
      trackedFiles: 2,
      update: null,
    });
    const state = await service.state(serverId, "");
    expect(state.current?.label).toBe("Pack de test");

    const [row] = await db.select().from(serverEngines).where(eq(serverEngines.serverId, serverId));
    expect(row?.installedBy).toBe(userId);
  });

  it("une mise à jour repart des fichiers suivis de la version précédente", async () => {
    await service.install(serverId, "modpack:pack", "v1");
    await service.install(serverId, "modpack:pack", "v2");

    expect(installer.run).toHaveBeenLastCalledWith(
      serverId,
      PREPARED,
      FABRIC,
      { "mods/a.jar": "10:t1", "config/a.toml": "3:t1" },
      expect.any(Function),
    );
  });

  it("une plateforme remplace le suivi du pack", async () => {
    await service.install(serverId, "modpack:pack", "v1");
    await service.install(serverId, "paper:paper", "1.21.1");

    expect(await service.current(serverId)).toMatchObject({
      kind: "jar",
      label: "Paper",
      versionId: "1.21.1",
      gameVersion: "1.21.1",
      pack: null,
      trackedFiles: 0,
    });
  });

  it("la sauvegarde préalable passe serveur arrêté et verrouillé, avant toute écriture", async () => {
    const beforeWrite = vi.fn(async () => {
      const [row] = await db
        .select({ state: servers.state })
        .from(servers)
        .where(eq(servers.id, serverId));
      events.push(`backup:${row?.state}`);
    });

    await service.install(serverId, "modpack:pack", "v1", { beforeWrite });
    expect(events).toEqual(["stop", "backup:installing", "run"]);
  });

  it("une sauvegarde préalable ratée n'écrit rien et rend le serveur", async () => {
    const beforeWrite = vi.fn(async () => {
      throw new Error("La sauvegarde préalable a échoué : rien n'a été modifié.");
    });

    await expect(service.install(serverId, "modpack:pack", "v1", { beforeWrite })).rejects.toThrow(
      /sauvegarde préalable a échoué/,
    );
    expect(installer.run).not.toHaveBeenCalled();
    expect(await service.current(serverId)).toBeNull();
    const [row] = await db
      .select({ state: servers.state })
      .from(servers)
      .where(eq(servers.id, serverId));
    expect(row?.state).toBeNull();
  });

  it("la veille signale une version plus récente, une seule fois, et la panne n'efface rien", async () => {
    await service.install(serverId, "modpack:pack", "v1");
    packs.newerVersion.mockResolvedValue({ id: "v2", label: "2.0 · 1.21.1" });

    const premier = await service.checkPackUpdates(100, "0 seconds");
    expect(premier.get(serverId)).toEqual([{ name: "Pack de test", version: "2.0 · 1.21.1" }]);
    expect(packs.newerVersion).toHaveBeenCalledWith("pack", {
      versionId: "v1",
      publishedAt: expect.any(String),
      gameVersion: "1.21.1",
      loader: "fabric",
    });
    expect((await service.current(serverId))?.update).toEqual({
      versionId: "v2",
      label: "2.0 · 1.21.1",
    });

    const second = await service.checkPackUpdates(100, "0 seconds");
    expect(second.size).toBe(0);

    packs.newerVersion.mockRejectedValueOnce(new Error("Modrinth indisponible"));
    await service.checkPackUpdates(100, "0 seconds");
    expect((await service.current(serverId))?.update?.versionId).toBe("v2");
  });

  it("une réinstallation réussie par le daemon efface le moteur retenu", async () => {
    await service.install(serverId, "modpack:pack", "v1");
    const [server] = await db.select({ nodeId: servers.nodeId }).from(servers);
    const remote = new RemoteServerService(
      db,
      { notifyServerOwner: vi.fn(async () => {}) } as unknown as NotificationsService,
      { emit: vi.fn(async () => {}) } as unknown as WebhookEmitterService,
    );

    await remote.markInstalled(server?.nodeId as string, serverId, {
      successful: false,
      reinstall: true,
    });
    expect(await service.current(serverId)).not.toBeNull();

    await remote.markInstalled(server?.nodeId as string, serverId, {
      successful: true,
      reinstall: true,
    });
    expect(await service.current(serverId)).toBeNull();
  });
});
