import { ConflictException, Logger } from "@nestjs/common";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FauxWings } from "../../test/faux-wings";
import type { WingsClientService } from "../wings/wings-client.service";
import type { CurseForgeClient } from "./curseforge.client";
import { CurseForgePackService } from "./curseforge-pack";
import type { LoaderResult } from "./forge-install.service";
import { ModpackSourceService, type PackVersion } from "./modpack-source";
import { PackInstallerService, type PackOutcome } from "./pack-installer.service";
import { STAGING } from "./pack-workspace";
import type { DetectedRuntime } from "./server-runtime";

/**
 * Installation et mise à jour d'un modpack, contre un daemon en mémoire qui
 * suit le contrat de Wings (`FauxWings`).
 */

const SERVER = "33333333-3333-4333-8333-333333333333";
const FABRIC: DetectedRuntime = {
  game: "minecraft",
  loader: "fabric",
  gameVersion: "1.21.1",
  directory: "/mods",
};
const FORGE: DetectedRuntime = { ...FABRIC, loader: "forge" };
const CDN = "https://cdn.modrinth.com/data";

beforeAll(() => {
  Logger.overrideLogger(false);
});

function mod(name: string, extra: Record<string, unknown> = {}) {
  return { path: `mods/${name}`, downloads: [`${CDN}/m/${name}`], ...extra };
}

function mrpack(files: unknown[], extra: Record<string, string> = {}) {
  return {
    "modrinth.index.json": JSON.stringify({
      formatVersion: 1,
      game: "minecraft",
      versionId: "1.0",
      name: "Pack de test",
      files,
      dependencies: { minecraft: "1.21.1", "fabric-loader": "0.16.10" },
    }),
    ...extra,
  };
}

function modrinth(daemon: FauxWings, versions: Record<string, Record<string, string>>) {
  const source = new ModpackSourceService();
  vi.spyOn(source, "version").mockImplementation(async (id: string) => {
    const url = `${CDN}/pack/versions/${id}/pack.mrpack`;
    const archive = versions[id];
    if (!archive) return null;
    daemon.archives.set(url, archive);
    return {
      id,
      projectId: "pack",
      label: `${id} · 1.21.1`,
      gameVersion: "1.21.1",
      loaders: ["fabric"],
      publishedAt: "2026-01-01T00:00:00Z",
      archive: { url, fileName: "pack.mrpack" },
    } satisfies PackVersion;
  });
  return source;
}

function installer(daemon: FauxWings, source: ModpackSourceService, cf?: CurseForgePackService) {
  return new PackInstallerService(
    daemon as unknown as WingsClientService,
    source,
    cf ?? ({} as CurseForgePackService),
  );
}

async function poser(
  svc: PackInstallerService,
  optionId: string,
  versionId: string,
  runtime: DetectedRuntime,
  previous: Record<string, string> = {},
  loader = vi.fn(async (): Promise<LoaderResult> => ({ notice: null, installed: null })),
): Promise<PackOutcome> {
  const prepared = await svc.prepare(optionId, versionId, runtime);
  return svc.run(SERVER, prepared, runtime, previous, loader);
}

describe("modpack Modrinth : installation", () => {
  it("pose les mods du serveur, applique les surcharges et garde ce qui est au serveur", async () => {
    const daemon = new FauxWings();
    // Un serveur qui a déjà vécu : un dossier config/, son monde, ses réglages.
    daemon.put("config/autre.toml", "x=1");
    daemon.put("server.properties", "motd=le mien");
    daemon.put("world/level.dat", "monde");

    const mods = Array.from({ length: 9 }, (_, i) => mod(`m${i}.jar`));
    const source = modrinth(daemon, {
      v1: mrpack(
        [
          ...mods,
          mod("sodium.jar", { env: { client: "required", server: "unsupported" } }),
          { path: "../../evil.jar", downloads: [`${CDN}/m/evil.jar`] },
          { path: "mods/ssrf.jar", downloads: ["http://169.254.169.254/latest"] },
        ],
        {
          "overrides/config/lithium.toml": "a=1",
          "overrides/server.properties": "motd=du pack",
          "server-overrides/config/lithium.toml": "a=serveur",
        },
      ),
    });
    const loader = vi.fn(async (): Promise<LoaderResult> => ({ notice: null, installed: null }));

    const outcome = await poser(
      installer(daemon, source),
      "modpack:pack",
      "v1",
      FABRIC,
      {},
      loader,
    );

    // Régression : l'ancien code déplaçait `overrides/config` entier, que Wings
    // refuse dès que `config/` existe — les réglages du pack n'arrivaient jamais.
    expect(daemon.read("config/lithium.toml")).toBe("a=serveur");
    expect(daemon.read("config/autre.toml")).toBe("x=1");
    expect(daemon.read("server.properties")).toBe("motd=le mien");
    expect(daemon.read("world/level.dat")).toBe("monde");

    expect(daemon.under("mods")).toEqual(mods.map((m) => m.path).sort());
    // Régression : les mods du seul client n'étaient pas écartés.
    expect(daemon.pulled).not.toContain(`${CDN}/m/sodium.jar`);
    expect(daemon.pulled.some((url) => url.includes("evil") || url.includes("169.254"))).toBe(
      false,
    );
    // Régression : six téléchargements de front, quand Wings en refuse plus de trois.
    expect(daemon.maxActive).toBeLessThanOrEqual(3);

    expect(daemon.under(STAGING)).toEqual([]);
    expect(loader).toHaveBeenCalledWith({ loader: "fabric", version: "0.16.10" }, "1.21.1");
    expect(outcome.missing).toEqual([]);
    expect(outcome.kept).toEqual(["server.properties"]);
    expect(Object.keys(outcome.record.files).sort()).toEqual(
      ["config/lithium.toml", ...mods.map((m) => m.path)].sort(),
    );
    expect(outcome.record).toMatchObject({
      source: "modrinth",
      projectId: "pack",
      label: "Pack de test",
      versionId: "v1",
      loader: "fabric 0.16.10",
      gameVersion: "1.21.1",
    });
  });

  it("dit les fichiers non posés au lieu de les compter comme posés", async () => {
    const daemon = new FauxWings();
    daemon.failing.add(`${CDN}/m/casse.jar`);
    const source = modrinth(daemon, { v1: mrpack([mod("ok.jar"), mod("casse.jar")]) });

    const outcome = await poser(installer(daemon, source), "modpack:pack", "v1", FABRIC);

    expect(outcome.missing).toEqual(["mods/casse.jar"]);
    expect(outcome.written).toBe(1);
    expect(outcome.record.files["mods/casse.jar"]).toBeUndefined();
  });

  it("refuse un pack Forge sur un serveur Fabric avant d'ouvrir quoi que ce soit", async () => {
    const daemon = new FauxWings();
    const source = modrinth(daemon, { v1: mrpack([]) });
    vi.spyOn(source, "version").mockResolvedValueOnce({
      id: "v1",
      projectId: "pack",
      label: "v1",
      gameVersion: "1.20.1",
      loaders: ["forge"],
      publishedAt: "2026-01-01T00:00:00Z",
      archive: { url: `${CDN}/pack/v1.mrpack`, fileName: "pack.mrpack" },
    });

    await expect(installer(daemon, source).prepare("modpack:pack", "v1", FABRIC)).rejects.toThrow(
      /demande forge/,
    );
    expect(daemon.pulled).toEqual([]);
  });

  it("refuse une version qui appartient à un autre projet", async () => {
    const daemon = new FauxWings();
    const source = modrinth(daemon, { v1: mrpack([]) });
    await expect(installer(daemon, source).prepare("modpack:autre", "v1", FABRIC)).rejects.toThrow(
      /n'appartient pas/,
    );
  });
});

describe("modpack Modrinth : mise à jour", () => {
  async function installeV1() {
    const daemon = new FauxWings();
    daemon.put("world/level.dat", "monde");
    const source = modrinth(daemon, {
      v1: mrpack([mod("lithium-1.jar"), mod("vieux.jar")], {
        "overrides/config/lithium.toml": "a=1",
        "overrides/config/retire.toml": "r=1",
      }),
      v2: mrpack([mod("lithium-2.jar")], {
        "overrides/config/lithium.toml": "a=2",
        "overrides/config/nouveau.toml": "n=1",
      }),
    });
    const svc = installer(daemon, source);
    const v1 = await poser(svc, "modpack:pack", "v1", FABRIC);
    return { daemon, svc, v1 };
  }

  it("remplace les fichiers du pack précédent et retire ceux qui ont disparu", async () => {
    const { daemon, svc, v1 } = await installeV1();

    const v2 = await poser(svc, "modpack:pack", "v2", FABRIC, v1.record.files);

    expect(daemon.under("mods")).toEqual(["mods/lithium-2.jar"]);
    expect(daemon.read("config/lithium.toml")).toBe("a=2");
    expect(daemon.read("config/nouveau.toml")).toBe("n=1");
    expect(daemon.has("config/retire.toml")).toBe(false);
    expect(daemon.read("world/level.dat")).toBe("monde");
    expect(v2.removed).toBe(3);
    expect(v2.kept).toEqual([]);
  });

  it("garde une configuration modifiée par l'utilisateur, et la garde encore ensuite", async () => {
    const { daemon, svc, v1 } = await installeV1();
    daemon.touch("config/lithium.toml", "a=réglé à la main");
    daemon.touch("config/retire.toml", "r=réglé à la main");

    const v2 = await poser(svc, "modpack:pack", "v2", FABRIC, v1.record.files);

    expect(daemon.read("config/lithium.toml")).toBe("a=réglé à la main");
    // Absent de la nouvelle version, mais modifié : laissé en place.
    expect(daemon.read("config/retire.toml")).toBe("r=réglé à la main");
    expect(v2.kept).toEqual(["config/lithium.toml"]);
    expect(v2.record.files["config/lithium.toml"]).toBe(v1.record.files["config/lithium.toml"]);
    expect(v2.record.files["config/retire.toml"]).toBeUndefined();
  });
});

describe("modpack CurseForge", () => {
  const EDGE = "https://edge.forgecdn.net/files";

  function curseforge(routes: Record<string, unknown>, calls: string[] = []) {
    const client = {
      call: vi.fn(async (path: string, body?: unknown) => {
        calls.push(body === undefined ? path : `POST ${path}`);
        const key = body === undefined ? path : `POST ${path}`;
        if (!(key in routes)) throw new Error(`route inattendue ${key}`);
        return { data: routes[key] };
      }),
    };
    return new CurseForgePackService(client as unknown as CurseForgeClient);
  }

  const packFile = {
    id: 100,
    modId: 42,
    displayName: "Pack 1.0",
    fileName: "pack-1.0.zip",
    downloadUrl: `${EDGE}/100/pack-1.0.zip`,
    fileDate: "2026-02-01T00:00:00Z",
    gameVersions: ["1.20.1", "Forge"],
    serverPackFileId: null as number | null,
  };

  it("préfère le pack serveur, et en déballe le dossier enveloppant", async () => {
    const daemon = new FauxWings();
    daemon.put("server.properties", "motd=le mien");
    const serverPack = {
      ...packFile,
      id: 101,
      fileName: "pack-1.0-server.zip",
      downloadUrl: `${EDGE}/101/pack-1.0-server.zip`,
      isServerPack: true,
    };
    daemon.archives.set(serverPack.downloadUrl, {
      "Pack Server/mods/create.jar": "jar",
      "Pack Server/config/create.toml": "c=1",
      "Pack Server/server.properties": "motd=du pack",
      "Pack Server/run.sh": "java @user_jvm_args.txt",
    });
    const cf = curseforge({
      "/mods/42/files/100": { ...packFile, serverPackFileId: 101 },
      "/mods/42/files/101": serverPack,
      "/mods/42": { id: 42, name: "Create Above", summary: "" },
    });
    const loader = vi.fn(
      async (): Promise<LoaderResult> => ({ notice: "Forge à régler", installed: null }),
    );

    const outcome = await poser(
      installer(daemon, new ModpackSourceService(), cf),
      "curseforge-pack:42",
      "100",
      FORGE,
      {},
      loader,
    );

    expect(daemon.pulled).toEqual([serverPack.downloadUrl]);
    expect(daemon.read("mods/create.jar")).toBe("jar");
    expect(daemon.read("config/create.toml")).toBe("c=1");
    expect(daemon.read("run.sh")).toBe("java @user_jvm_args.txt");
    expect(daemon.read("server.properties")).toBe("motd=le mien");
    expect(daemon.under(STAGING)).toEqual([]);
    expect(loader).toHaveBeenCalledWith({ loader: "forge", version: "" }, "1.20.1");
    expect(outcome.notice).toBe("Forge à régler");
    expect(outcome.loader).toBeNull();
    expect(outcome.record).toMatchObject({
      source: "curseforge",
      projectId: "42",
      label: "Create Above",
      versionId: "100",
      publishedAt: "2026-02-01T00:00:00Z",
    });
  });

  function manifestPack(fileB: { downloadUrl: string | null }) {
    const daemon = new FauxWings();
    daemon.put("config/autre.toml", "x=1");
    daemon.archives.set(packFile.downloadUrl, {
      "manifest.json": JSON.stringify({
        manifestType: "minecraftModpack",
        manifestVersion: 1,
        name: "Pack",
        minecraft: { version: "1.20.1", modLoaders: [{ id: "forge-47.2.0", primary: true }] },
        files: [
          { projectID: 1, fileID: 11, required: true },
          { projectID: 2, fileID: 22, required: true },
          { projectID: 3, fileID: 33, required: true },
          { projectID: 4, fileID: 44, required: false },
        ],
        overrides: "overrides",
      }),
      "overrides/config/pack.toml": "p=1",
    });
    const cf = curseforge({
      "/mods/42/files/100": packFile,
      "/mods/42": { id: 42, name: "Pack", summary: "" },
      "POST /mods/files": [
        { id: 11, modId: 1, displayName: "A", fileName: "a.jar", downloadUrl: `${EDGE}/11/a.jar` },
        { id: 22, modId: 2, displayName: "B 1.0", fileName: "b.jar", ...fileB },
        {
          id: 33,
          modId: 3,
          displayName: "Tex",
          fileName: "tex.zip",
          downloadUrl: `${EDGE}/33/t.zip`,
        },
      ],
      "POST /mods": [
        { id: 1, name: "Mod A", classId: 6 },
        { id: 2, name: "Mod B", classId: 6 },
        { id: 3, name: "Textures", classId: 12 },
      ],
    });
    return { daemon, svc: installer(daemon, new ModpackSourceService(), cf) };
  }

  it("sans pack serveur : résout le manifeste, tire les mods et applique les surcharges", async () => {
    const { daemon, svc } = manifestPack({ downloadUrl: `${EDGE}/22/b.jar` });
    const loader = vi.fn(async (): Promise<LoaderResult> => ({ notice: null, installed: null }));

    const outcome = await poser(svc, "curseforge-pack:42", "100", FORGE, {}, loader);

    expect(daemon.under("mods")).toEqual(["mods/a.jar", "mods/b.jar"]);
    expect(daemon.read("config/pack.toml")).toBe("p=1");
    expect(daemon.read("config/autre.toml")).toBe("x=1");
    expect(daemon.pulled).not.toContain(`${EDGE}/33/t.zip`);
    expect(outcome.notice).toMatch(/1 fichier\(s\) réservés au client/);
    expect(loader).toHaveBeenCalledWith({ loader: "forge", version: "47.2.0" }, "1.20.1");
  });

  it("refuse, en le nommant, un mod dont l'auteur interdit la distribution — sans rien toucher", async () => {
    const { daemon, svc } = manifestPack({ downloadUrl: null });
    const avant = daemon.under();

    const refus = poser(svc, "curseforge-pack:42", "100", FORGE);
    await expect(refus).rejects.toBeInstanceOf(ConflictException);
    await expect(refus).rejects.toThrow(/Mod B/);
    await expect(refus).rejects.toThrow(/refuse la distribution/);

    expect(daemon.under()).toEqual(avant);
    expect(daemon.pulled).toEqual([packFile.downloadUrl]);
  });

  it("refuse un pack dont l'archive elle-même n'est pas distribuable, avant tout", async () => {
    const daemon = new FauxWings();
    const cf = curseforge({
      "/mods/42/files/100": { ...packFile, downloadUrl: null },
      "/mods/42": { id: 42, name: "Pack", summary: "" },
    });
    await expect(
      installer(daemon, new ModpackSourceService(), cf).prepare("curseforge-pack:42", "100", FORGE),
    ).rejects.toThrow(/refuse la distribution/);
    expect(daemon.pulled).toEqual([]);
  });

  it("refuse un fichier d'un autre projet que le pack annoncé", async () => {
    const cf = curseforge({ "/mods/42/files/100": { ...packFile, modId: 7 } });
    await expect(
      installer(new FauxWings(), new ModpackSourceService(), cf).prepare(
        "curseforge-pack:42",
        "100",
        FORGE,
      ),
    ).rejects.toThrow(/n'appartient pas/);
  });
});

describe("défauts relevés en revue", () => {
  const EDGE = "https://edge.forgecdn.net/files";

  function curseforge(routes: Record<string, unknown>) {
    const client = {
      call: vi.fn(async (path: string, body?: unknown) => {
        const key = body === undefined ? path : `POST ${path}`;
        if (!(key in routes)) throw new Error(`route inattendue ${key}`);
        return { data: routes[key] };
      }),
    };
    return new CurseForgePackService(client as unknown as CurseForgeClient);
  }

  const packFile = (fileName = "pack-1.0.zip") => ({
    id: 100,
    modId: 42,
    displayName: "Pack 1.0",
    fileName,
    downloadUrl: `${EDGE}/100/pack-1.0.zip`,
    fileDate: "2026-02-01T00:00:00Z",
    gameVersions: ["1.20.1", "Forge"],
    serverPackFileId: null,
  });

  /** Un manifeste avec un mod, un datapack (classe 6945) et un monde (classe 17). */
  function packAvecDatapack(daemon: FauxWings, datapack: string) {
    daemon.archives.set(`${EDGE}/100/pack-1.0.zip`, {
      "manifest.json": JSON.stringify({
        manifestType: "minecraftModpack",
        manifestVersion: 1,
        name: "Pack",
        minecraft: { version: "1.20.1", modLoaders: [{ id: "forge-47.2.0", primary: true }] },
        files: [
          { projectID: 1, fileID: 11, required: true },
          { projectID: 5, fileID: 55, required: true },
          { projectID: 7, fileID: 77, required: true },
        ],
        overrides: "overrides",
      }),
    });
    const cf = curseforge({
      "/mods/42/files/100": packFile(),
      "/mods/42": { id: 42, name: "Pack", summary: "" },
      "POST /mods/files": [
        { id: 11, modId: 1, displayName: "A", fileName: "a.jar", downloadUrl: `${EDGE}/11/a.jar` },
        {
          id: 55,
          modId: 5,
          displayName: "Recettes",
          fileName: datapack,
          downloadUrl: `${EDGE}/55/${datapack}`,
        },
        {
          id: 77,
          modId: 7,
          displayName: "Carte",
          fileName: "carte.zip",
          downloadUrl: `${EDGE}/77/c.zip`,
        },
      ],
      "POST /mods": [
        { id: 1, name: "Mod A", classId: 6 },
        { id: 5, name: "Recettes du pack", classId: 6945 },
        { id: 7, name: "Carte d'aventure", classId: 17 },
      ],
    });
    return installer(daemon, new ModpackSourceService(), cf);
  }

  it("pose un datapack du manifeste dans le dossier datapacks du monde, et le dit", async () => {
    const daemon = new FauxWings();
    daemon.put("server.properties", "motd=x\nlevel-name=monde\\ principal\n");
    daemon.put("monde principal/level.dat", "monde");

    const outcome = await poser(
      packAvecDatapack(daemon, "recettes-1.zip"),
      "curseforge-pack:42",
      "100",
      FORGE,
    );

    // Régression : tout ce qui n'était pas un mod passait pour « du client »,
    // et le datapack était écarté sans un mot.
    expect(daemon.has("monde principal/datapacks/recettes-1.zip")).toBe(true);
    expect(daemon.has("mods/a.jar")).toBe(true);
    expect(daemon.pulled).not.toContain(`${EDGE}/77/c.zip`);
    expect(outcome.notice).toMatch(/1 datapack\(s\) posé\(s\) dans monde principal\/datapacks/);
    expect(outcome.notice).toMatch(/Carte d'aventure/);
    expect(outcome.notice).not.toMatch(/réservés au client/);
    expect(outcome.record.files["monde principal/datapacks/recettes-1.zip"]).toBeDefined();
  });

  it("une mise à jour remplace le datapack du pack au lieu de garder les deux versions", async () => {
    const daemon = new FauxWings();
    const v1 = await poser(
      packAvecDatapack(daemon, "recettes-1.zip"),
      "curseforge-pack:42",
      "100",
      FORGE,
    );
    daemon.put("world/datapacks/a-moi.zip", "posé à la main");

    await poser(
      packAvecDatapack(daemon, "recettes-2.zip"),
      "curseforge-pack:42",
      "100",
      FORGE,
      v1.record.files,
    );

    expect(daemon.under("world/datapacks")).toEqual([
      "world/datapacks/a-moi.zip",
      "world/datapacks/recettes-2.zip",
    ]);
  });

  it("refuse le nom d'archive d'un .mrpack qui sortirait du dossier de travail", async () => {
    const daemon = new FauxWings();
    const source = modrinth(daemon, { v1: mrpack([]) });
    vi.spyOn(source, "version").mockResolvedValueOnce({
      id: "v1",
      projectId: "pack",
      label: "v1",
      gameVersion: "1.21.1",
      loaders: ["fabric"],
      publishedAt: "2026-01-01T00:00:00Z",
      archive: { url: `${CDN}/pack/v1.mrpack`, fileName: "../../mods/x.mrpack" },
    });

    // Régression : le nom venait de l'API sans contrôle, contrairement au pack serveur.
    await expect(installer(daemon, source).prepare("modpack:pack", "v1", FABRIC)).rejects.toThrow(
      /nom de fichier invalide/,
    );
    expect(daemon.pulled).toEqual([]);
  });

  it("refuse le nom d'archive d'un pack CurseForge sans pack serveur", async () => {
    const cf = curseforge({
      "/mods/42/files/100": packFile("../pack.zip"),
      "/mods/42": { id: 42, name: "Pack", summary: "" },
    });
    await expect(
      installer(new FauxWings(), new ModpackSourceService(), cf).prepare(
        "curseforge-pack:42",
        "100",
        FORGE,
      ),
    ).rejects.toThrow(/nom de fichier invalide/);
  });

  it("un chargeur qui échoue après les fichiers n'efface pas le suivi du pack", async () => {
    const daemon = new FauxWings();
    const source = modrinth(daemon, {
      v1: mrpack([mod("a.jar")], { "overrides/config/a.toml": "a=1" }),
    });
    const loader = vi.fn(async (): Promise<LoaderResult> => {
      throw new Error("Fabric injoignable");
    });

    const outcome = await poser(
      installer(daemon, source),
      "modpack:pack",
      "v1",
      FABRIC,
      {},
      loader,
    );

    // Régression : l'erreur remontait avant l'enregistrement, et la mise à
    // jour suivante tenait tous les fichiers pour neufs.
    expect(Object.keys(outcome.record.files).sort()).toEqual(["config/a.toml", "mods/a.jar"]);
    expect(outcome.notice).toMatch(/la pose de Fabric Loader 0\.16\.10 a échoué/);
    expect(daemon.under(STAGING)).toEqual([]);
  });
  it("le compte rendu dit le chargeur posé avec le pack", async () => {
    const daemon = new FauxWings();
    const source = modrinth(daemon, {
      v1: mrpack([mod("a.jar")], { "overrides/config/a.toml": "a=1" }),
    });
    const loader = vi.fn(
      async (): Promise<LoaderResult> => ({
        notice: null,
        installed: "Fabric Loader 0.16.10 pour Minecraft 1.21.1",
      }),
    );

    const outcome = await poser(
      installer(daemon, source),
      "modpack:pack",
      "v1",
      FABRIC,
      {},
      loader,
    );

    expect(outcome.loader).toBe("Fabric Loader 0.16.10 pour Minecraft 1.21.1");
    expect(outcome.notice).toBeNull();
    expect(Object.keys(outcome.record.files).sort()).toEqual(["config/a.toml", "mods/a.jar"]);
  });
});
