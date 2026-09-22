import { describe, expect, it } from "vitest";
import { EggParseError, parsePterodactylEgg } from "./pterodactyl-egg";

/** Un export minimal mais complet, tel que Pterodactyl le produit. */
function egg(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    meta: { version: "PTDL_v2" },
    name: "Paper",
    author: "eggs@pterodactyl.io",
    description: "Serveur Minecraft Paper",
    docker_images: { "Java 21": "ghcr.io/pterodactyl/yolks:java_21" },
    startup: "java -jar server.jar",
    config: { files: "{}", startup: '{"done":")! For help"}', stop: "stop", logs: "{}" },
    scripts: {
      installation: {
        script: "#!/bin/bash\necho ok",
        container: "debian:bookworm-slim",
        entrypoint: "bash",
      },
    },
    variables: [
      {
        name: "Version",
        env_variable: "MINECRAFT_VERSION",
        default_value: "latest",
        user_viewable: true,
        user_editable: true,
        rules: "required|string",
      },
    ],
    ...overrides,
  };
}

describe("parsePterodactylEgg", () => {
  it("lit un export v2 complet", () => {
    const parsed = parsePterodactylEgg(egg());
    expect(parsed.name).toBe("Paper");
    expect(parsed.installContainer).toBe("debian:bookworm-slim");
    expect(parsed.dockerImages).toEqual({ "Java 21": "ghcr.io/pterodactyl/yolks:java_21" });
    expect(parsed.variables).toHaveLength(1);
    expect(parsed.variables[0]?.envVariable).toBe("MINECRAFT_VERSION");
  });

  it("ramène le `docker_image` unique du format v1 à la table du v2", () => {
    const parsed = parsePterodactylEgg(
      egg({ meta: { version: "PTDL_v1" }, docker_images: undefined, docker_image: "alpine:3" }),
    );
    expect(parsed.dockerImages).toEqual({ "alpine:3": "alpine:3" });
  });

  it("déplie les blocs de configuration sérialisés en chaîne", () => {
    // Pterodactyl les rend tantôt en objet, tantôt en JSON encodé. Laisser
    // passer une chaîne donnerait un serveur muet, sans erreur visible.
    const parsed = parsePterodactylEgg(egg());
    expect(parsed.configStartup).toEqual({ done: ")! For help" });
  });

  it("remplace un bloc de configuration illisible par un bloc vide", () => {
    const parsed = parsePterodactylEgg(egg({ config: { files: "pas du json", stop: "stop" } }));
    expect(parsed.configFiles).toEqual({});
  });

  it("refuse un egg sans commande de démarrage, en le nommant", () => {
    expect(() => parsePterodactylEgg(egg({ startup: "   " }))).toThrow(EggParseError);
    expect(() => parsePterodactylEgg(egg({ startup: "" }))).toThrow(/Paper/);
  });

  it("refuse un egg sans conteneur d'installation", () => {
    expect(() => parsePterodactylEgg(egg({ scripts: { installation: { script: "x" } } }))).toThrow(
      /conteneur d'installation/,
    );
  });

  it("refuse un egg sans aucune image Docker", () => {
    expect(() => parsePterodactylEgg(egg({ docker_images: {}, docker_image: undefined }))).toThrow(
      /image Docker/,
    );
  });

  it("refuse un format qu'on ne sait pas lire", () => {
    expect(() => parsePterodactylEgg(egg({ meta: { version: "PTDL_v9" } }))).toThrow(/PTDL_v9/);
  });

  it("refuse ce qui n'est pas un objet", () => {
    expect(() => parsePterodactylEgg("{}")).toThrow(EggParseError);
    expect(() => parsePterodactylEgg([])).toThrow(EggParseError);
    expect(() => parsePterodactylEgg(null)).toThrow(EggParseError);
  });

  it("garde la première de deux variables homonymes au lieu de refuser l'egg", () => {
    const parsed = parsePterodactylEgg(
      egg({
        variables: [
          { name: "A", env_variable: "PORT", default_value: "1" },
          { name: "B", env_variable: "PORT", default_value: "2" },
        ],
      }),
    );
    expect(parsed.variables).toHaveLength(1);
    expect(parsed.variables[0]?.defaultValue).toBe("1");
  });

  it("rend une variable non éditable par défaut, et visible par défaut", () => {
    const parsed = parsePterodactylEgg(egg({ variables: [{ name: "A", env_variable: "PORT" }] }));
    expect(parsed.variables[0]?.userEditable).toBe(false);
    expect(parsed.variables[0]?.userViewable).toBe(true);
  });

  it("accepte une valeur par défaut numérique", () => {
    // Certains eggs publiés écrivent `"default_value": 25565`.
    const parsed = parsePterodactylEgg(
      egg({ variables: [{ name: "Port", env_variable: "PORT", default_value: 25565 }] }),
    );
    expect(parsed.variables[0]?.defaultValue).toBe("25565");
  });
});
