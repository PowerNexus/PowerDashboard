import { describe, expect, it } from "vitest";
import { readGameQuery } from "./game-query";
import { exportPterodactylEgg, parsePterodactylEgg } from "./pterodactyl-egg";

describe("readGameQuery", () => {
  it("lit une déclaration complète", () => {
    expect(readGameQuery({ protocol: "a2s", port_variable: "QUERY_PORT", port_offset: 1 })).toEqual(
      { protocol: "a2s", port_variable: "QUERY_PORT", port_offset: 1 },
    );
  });

  it("lit un protocole seul", () => {
    expect(readGameQuery({ protocol: "cfx" })).toEqual({ protocol: "cfx" });
  });

  it("écarte une déclaration sans protocole connu", () => {
    for (const raw of [null, "a2s", [], {}, { protocol: "gamespy" }, { protocol: 1 }]) {
      expect(readGameQuery(raw)).toBeNull();
    }
  });

  it("écarte seuls les champs facultatifs douteux", () => {
    expect(
      readGameQuery({ protocol: "a2s", port_variable: "QUERY PORT; rm", port_offset: 1.5 }),
    ).toEqual({ protocol: "a2s" });
    expect(readGameQuery({ protocol: "a2s", port_offset: 70_000 })).toEqual({ protocol: "a2s" });
    expect(readGameQuery({ protocol: "a2s", port_offset: "1" })).toEqual({ protocol: "a2s" });
  });
});

describe("clé game_query d'un egg", () => {
  const egg = {
    meta: { version: "PTDL_v2" },
    name: "Rust maison",
    startup: "./RustDedicated",
    docker_images: { Rust: "ghcr.io/parkervcp/games:rust" },
    scripts: { installation: { script: "", container: "debian", entrypoint: "bash" } },
    game_query: { protocol: "a2s", port_variable: "QUERY_PORT" },
  };

  it("est lue à l'import et survit à l'export", () => {
    const lu = parsePterodactylEgg(egg);
    expect(lu.gameQuery).toEqual({ protocol: "a2s", port_variable: "QUERY_PORT" });
    expect(exportPterodactylEgg(lu).game_query).toEqual(lu.gameQuery);
  });

  it("est absente de l'export quand l'egg n'en déclare pas", () => {
    const { game_query: _absente, ...pterodactyl } = egg;
    const lu = parsePterodactylEgg(pterodactyl);
    expect(lu.gameQuery).toBeNull();
    expect("game_query" in exportPterodactylEgg(lu)).toBe(false);
  });
});
