import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  eggSettingsFor,
  FORGE_MAVEN,
  metadataUrl,
  NEOFORGE_LEGACY_MAVEN,
  NEOFORGE_MAVEN,
  packLoaderStillInstalled,
  parseMavenVersions,
  refusForge,
  resolveForgeTarget,
} from "./forge-loader";

/** Extraits des index réels des deux dépôts. */
const FORGE_INDEX = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <groupId>net.minecraftforge</groupId>
  <artifactId>forge</artifactId>
  <versioning>
    <versions>
      <version>1.7.10-10.13.4.1614-1.7.10</version>
      <version>1.12.2-14.23.5.2860</version>
      <version>1.16.5-36.2.39</version>
      <version>1.20.1-47.2.0</version>
      <version>1.20.1-47.3.0</version>
    </versions>
  </versioning>
</metadata>`;

const NEOFORGE_INDEX = `<metadata><versioning><versions>
  <version>21.1.76</version>
  <version>21.1.77</version>
  <version>21.2.0-beta</version>
</versions></versioning></metadata>`;

const NEOFORGE_LEGACY_INDEX = `<metadata><versioning><versions>
  <version>1.20.1-47.1.105</version>
  <version>1.20.1-47.1.106</version>
</versions></versioning></metadata>`;

describe("versions de Forge et NeoForge : refus d'une valeur malformée", () => {
  it("accepte les versions telles que les manifestes les donnent", () => {
    expect(refusForge({ family: "forge", version: "47.3.0", gameVersion: "1.20.1" })).toBeNull();
    expect(
      refusForge({ family: "forge", version: "10.13.4.1614", gameVersion: "1.7.10" }),
    ).toBeNull();
    expect(
      refusForge({ family: "neoforge", version: "21.1.77", gameVersion: "1.21.1" }),
    ).toBeNull();
    expect(
      refusForge({ family: "neoforge", version: "21.0.0-beta", gameVersion: "1.21" }),
    ).toBeNull();
    expect(
      refusForge({ family: "neoforge", version: "47.1.106", gameVersion: "1.20.1" }),
    ).toBeNull();
  });

  it("refuse tout ce qui pourrait devenir un chemin ou une commande", () => {
    for (const version of [
      "../47.3.0",
      "47.3.0/../../x",
      "47.3.0;rm -rf /",
      "$(id)",
      "47.3.0 ",
      "47",
      "latest",
      "https://evil.example/forge.jar",
    ]) {
      expect(refusForge({ family: "forge", version, gameVersion: "1.20.1" }), version).toMatch(
        /malformée/,
      );
    }
    expect(refusForge({ family: "forge", version: "47.3.0", gameVersion: "1.20.1/.." })).toMatch(
      /Minecraft du pack .* malformée/,
    );
    expect(refusForge({ family: "forge", version: "", gameVersion: "1.20.1" })).toMatch(
      /ne dit pas quelle version de Forge/,
    );
  });

  it("refuse un NeoForge qui ne correspond pas à la version du jeu", () => {
    expect(refusForge({ family: "neoforge", version: "20.4.237", gameVersion: "1.21.1" })).toMatch(
      /ne correspond pas/,
    );
  });
});

describe("index des dépôts officiels", () => {
  it("lit les versions et écarte ce qui n'en a pas la forme", () => {
    expect(parseMavenVersions(FORGE_INDEX)).toContain("1.7.10-10.13.4.1614-1.7.10");
    expect(
      parseMavenVersions("<version>1.0</version><version>../x</version><version>a b</version>"),
    ).toEqual(["1.0"]);
  });

  it("ne lit que les dépôts officiels", () => {
    expect(metadataUrl({ family: "forge", gameVersion: "1.20.1" })).toBe(
      "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
    );
    expect(metadataUrl({ family: "neoforge", gameVersion: "1.21.1" })).toBe(
      "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
    );
    expect(metadataUrl({ family: "neoforge", gameVersion: "1.20.1" })).toBe(
      "https://maven.neoforged.net/releases/net/neoforged/forge/maven-metadata.xml",
    );
  });
});

describe("résolution et variables de l'egg", () => {
  it("Forge récent : la version telle quelle, l'installeur sur le dépôt de Forge", () => {
    const target = resolveForgeTarget(
      { family: "forge", version: "47.3.0", gameVersion: "1.20.1" },
      parseMavenVersions(FORGE_INDEX),
    );
    expect(target).toEqual({
      family: "forge",
      gameVersion: "1.20.1",
      loaderVersion: "47.3.0",
      installerUrl: `${FORGE_MAVEN}/1.20.1-47.3.0/forge-1.20.1-47.3.0-installer.jar`,
      label: "Forge 47.3.0 pour Minecraft 1.20.1",
    });
    expect(target && eggSettingsFor(target)).toEqual({
      LOADER: "forge",
      LOADER_VERSION: "47.3.0",
      MINECRAFT_VERSION: "1.20.1",
    });
  });

  it("Forge ancien : le suffixe de l'artefact est lu dans l'index, pas deviné", () => {
    const versions = parseMavenVersions(FORGE_INDEX);
    const ancien = resolveForgeTarget(
      { family: "forge", version: "10.13.4.1614", gameVersion: "1.7.10" },
      versions,
    );
    expect(ancien?.installerUrl).toBe(
      `${FORGE_MAVEN}/1.7.10-10.13.4.1614-1.7.10/forge-1.7.10-10.13.4.1614-1.7.10-installer.jar`,
    );
    // L'egg compose `<jeu>-<LOADER_VERSION>` : le suffixe voyage dans la variable.
    expect(ancien && eggSettingsFor(ancien)).toEqual({
      LOADER: "forge",
      LOADER_VERSION: "10.13.4.1614-1.7.10",
      MINECRAFT_VERSION: "1.7.10",
    });

    const douze = resolveForgeTarget(
      { family: "forge", version: "14.23.5.2860", gameVersion: "1.12.2" },
      versions,
    );
    expect(douze?.loaderVersion).toBe("14.23.5.2860");
  });

  it("NeoForge : son dépôt, et l'ancien artefact pour 1.20.1", () => {
    const recent = resolveForgeTarget(
      { family: "neoforge", version: "21.1.77", gameVersion: "1.21.1" },
      parseMavenVersions(NEOFORGE_INDEX),
    );
    expect(recent?.installerUrl).toBe(`${NEOFORGE_MAVEN}/21.1.77/neoforge-21.1.77-installer.jar`);
    expect(recent && eggSettingsFor(recent)).toEqual({
      LOADER: "neoforge",
      LOADER_VERSION: "21.1.77",
      MINECRAFT_VERSION: "1.21.1",
    });

    const legacy = resolveForgeTarget(
      { family: "neoforge", version: "47.1.106", gameVersion: "1.20.1" },
      parseMavenVersions(NEOFORGE_LEGACY_INDEX),
    );
    expect(legacy?.installerUrl).toBe(
      `${NEOFORGE_LEGACY_MAVEN}/1.20.1-47.1.106/forge-1.20.1-47.1.106-installer.jar`,
    );
    expect(legacy?.loaderVersion).toBe("47.1.106");
  });

  it("une version absente du dépôt, ou malformée, ne se résout pas", () => {
    const versions = parseMavenVersions(FORGE_INDEX);
    expect(
      resolveForgeTarget({ family: "forge", version: "47.9.9", gameVersion: "1.20.1" }, versions),
    ).toBeNull();
    // Le bon numéro sur une autre version du jeu ne passe pas pour autant.
    expect(
      resolveForgeTarget({ family: "forge", version: "47.3.0", gameVersion: "1.20.2" }, versions),
    ).toBeNull();
    expect(
      resolveForgeTarget({ family: "forge", version: "47.3.0/../x", gameVersion: "1.20.1" }, [
        ...versions,
        "1.20.1-47.3.0/../x",
      ]),
    ).toBeNull();
  });

  it("chaque adresse d'installeur reste sur un dépôt officiel", () => {
    const cibles = [
      resolveForgeTarget(
        { family: "forge", version: "36.2.39", gameVersion: "1.16.5" },
        parseMavenVersions(FORGE_INDEX),
      ),
      resolveForgeTarget(
        { family: "neoforge", version: "21.1.76", gameVersion: "1.21.1" },
        parseMavenVersions(NEOFORGE_INDEX),
      ),
    ];
    for (const cible of cibles) {
      const url = new URL(cible?.installerUrl ?? "");
      expect(["maven.minecraftforge.net", "maven.neoforged.net"]).toContain(url.hostname);
      expect(url.protocol).toBe("https:");
    }
  });

  it("l'egg compose les mêmes adresses que le panel", () => {
    // Le panel ne passe que des variables : c'est le script de l'egg qui
    // télécharge. Les deux doivent viser le même installeur.
    const script = readFileSync(
      fileURLToPath(
        new URL("../../../../../infra/eggs/minecraft-java/install.sh", import.meta.url),
      ),
      "utf8",
    );
    // Les variables du shell, écrites telles que le script les porte.
    const sh = (nom: string) => `$\{${nom}}`;
    expect(script).toContain(
      `${FORGE_MAVEN}/${sh("complet")}/forge-${sh("complet")}-installer.jar`,
    );
    expect(script).toContain(
      `https://maven.neoforged.net/releases/${sh("artefact")}/${sh("complet")}/${sh("nom")}-${sh("complet")}-installer.jar`,
    );
    expect(script).toContain('artefact="net/neoforged/forge"');
    expect(script).toContain('artefact="net/neoforged/neoforge"');
  });
});

describe("suivi du pack après une réinstallation par l'egg", () => {
  const pack = { kind: "pack", loader: "forge 47.3.0", gameVersion: "1.20.1" };

  it("tient quand les variables nomment exactement le chargeur du pack", () => {
    expect(
      packLoaderStillInstalled(pack, {
        LOADER: "forge",
        LOADER_VERSION: "47.3.0",
        MINECRAFT_VERSION: "1.20.1",
      }),
    ).toBe(true);
    expect(
      packLoaderStillInstalled(
        { kind: "pack", loader: "forge 10.13.4.1614", gameVersion: "1.7.10" },
        { LOADER: "forge", LOADER_VERSION: "10.13.4.1614-1.7.10", MINECRAFT_VERSION: "1.7.10" },
      ),
    ).toBe(true);
  });

  it("tombe dès qu'une variable diffère, et pour tout ce qui n'est pas Forge ou NeoForge", () => {
    const juste = { LOADER: "forge", LOADER_VERSION: "47.3.0", MINECRAFT_VERSION: "1.20.1" };
    expect(packLoaderStillInstalled(pack, { ...juste, LOADER_VERSION: "latest" })).toBe(false);
    expect(packLoaderStillInstalled(pack, { ...juste, LOADER_VERSION: "47.3.01" })).toBe(false);
    expect(packLoaderStillInstalled(pack, { ...juste, LOADER: "paper" })).toBe(false);
    expect(packLoaderStillInstalled(pack, { ...juste, MINECRAFT_VERSION: "1.20.2" })).toBe(false);
    expect(packLoaderStillInstalled({ ...pack, kind: "jar" }, juste)).toBe(false);
    // Fabric : comme avant, une réinstallation efface le suivi.
    expect(
      packLoaderStillInstalled(
        { kind: "pack", loader: "fabric 0.16.10", gameVersion: "1.20.1" },
        { LOADER: "fabric", LOADER_VERSION: "0.16.10", MINECRAFT_VERSION: "1.20.1" },
      ),
    ).toBe(false);
  });
});
