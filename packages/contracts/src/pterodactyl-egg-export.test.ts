import { describe, expect, it } from "vitest";
import { exportPterodactylEgg, type ParsedEgg, parsePterodactylEgg } from "./pterodactyl-egg";

/**
 * Export d'un egg : l'aller-retour export → import doit redonner **le même**
 * egg, au champ près.
 *
 * C'est la seule promesse de l'export, et la plus facile à rompre sans le
 * voir : un bloc de configuration écrit en objet plutôt qu'en chaîne, une
 * variable sans son `field_type`, un auteur `null` que Pterodactyl refuse…
 * Chacun produit un fichier d'apparence correcte, qui ne revient pas.
 */

/** Un egg riche : tout ce qu'un export peut perdre y est présent. */
const RICHE: ParsedEgg = {
  name: "Paper",
  description: "Serveur Minecraft Paper",
  author: "eggs@exemple.fr",
  dockerImages: {
    "Java 21": "ghcr.io/pterodactyl/yolks:java_21",
    "Java 17": "ghcr.io/pterodactyl/yolks:java_17",
  },
  startup: "java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}",
  configFiles: {
    "server.properties": {
      parser: "properties",
      find: { "server-port": "{{server.build.default.port}}", "query.port": "25565" },
    },
  },
  configStartup: { done: ")! For help, type " },
  configStop: "stop",
  configLogs: {},
  installScript: '#!/bin/bash\n# Accents et guillemets : « é » "x" \\n\ncd /mnt/server\n',
  installContainer: "ghcr.io/pterodactyl/installers:alpine",
  installEntrypoint: "ash",
  features: ["eula", "java_version"],
  fileDenylist: ["*.jar.old"],
  consoleCommands: ["say <message>", "whitelist add <joueur>"],
  variables: [
    {
      name: "Fichier du serveur",
      envVariable: "SERVER_JARFILE",
      description: "Nom du .jar à lancer",
      defaultValue: "server.jar",
      userViewable: true,
      userEditable: true,
      rules: "required|regex:/^([\\w\\d._-]+)(\\.jar)$/",
    },
    {
      name: "Version",
      envVariable: "MINECRAFT_VERSION",
      description: null,
      defaultValue: "",
      userViewable: false,
      userEditable: false,
      rules: "nullable|string|max:20",
    },
  ],
};

describe("exportPterodactylEgg", () => {
  it("redonne le même egg une fois réimporté", () => {
    expect(parsePterodactylEgg(exportPterodactylEgg(RICHE))).toEqual(RICHE);
  });

  it("redonne le même egg pour les valeurs nulles (auteur, description, arrêt)", () => {
    const minimal: ParsedEgg = {
      ...RICHE,
      author: null,
      description: null,
      configStop: null,
      features: [],
      fileDenylist: [],
      variables: [],
    };
    expect(parsePterodactylEgg(exportPterodactylEgg(minimal))).toEqual(minimal);
  });

  it("importe sans commande de console un egg venu de Pterodactyl, qui n'en déclare pas", () => {
    const { console_commands: _absente, ...pterodactyl } = exportPterodactylEgg(RICHE);
    expect(parsePterodactylEgg(pterodactyl).consoleCommands).toEqual([]);
  });

  it("reste stable : exporter ce qu'on a réimporté redonne le même fichier", () => {
    const instant = new Date("2026-09-23T10:00:00.000Z");
    const premier = exportPterodactylEgg(RICHE, instant);
    const second = exportPterodactylEgg(parsePterodactylEgg(premier), instant);
    expect(second).toEqual(premier);
  });

  it("écrit le format que Pterodactyl attend", () => {
    const fichier = exportPterodactylEgg(RICHE, new Date("2026-09-23T10:00:00.000Z"));

    expect(fichier.meta.version).toBe("PTDL_v2");
    expect(fichier.exported_at).toBe("2026-09-23T10:00:00+00:00");
    // Des chaînes JSON, pas des objets : le lecteur de Pterodactyl n'accepte
    // que la chaîne.
    expect(typeof fichier.config.files).toBe("string");
    expect(typeof fichier.config.startup).toBe("string");
    expect(typeof fichier.config.logs).toBe("string");
    expect(fichier.author).toBe("eggs@exemple.fr");
    expect(fichier.variables.every((v) => v.field_type === "text")).toBe(true);
    expect(fichier.variables[1]?.description).toBe("");
  });
});
