import { describe, expect, it } from "vitest";
import { type ProbePlanInput, probePlan } from "./probe-plan";

const serveur = (partiel: Partial<ProbePlanInput>): ProbePlanInput => ({
  eggName: "Jeu",
  nestName: "Famille",
  image: "ghcr.io/pterodactyl/yolks:debian",
  startup: "./start",
  declared: null,
  variables: {},
  port: 27_015,
  ports: [27_015, 27_016, 27_020, 27_100, 28_015, 28_017, 2456, 2460, 7777, 30_120, 40_000],
  ...partiel,
});

describe("probePlan : ce que l'egg déclare", () => {
  it("l'emporte sur le nom", () => {
    expect(
      probePlan(serveur({ eggName: "Paper", declared: { protocol: "a2s" }, port: 25_565 })),
    ).toEqual({ protocol: "a2s", port: 25_565 });
  });

  it("prend le port de la variable déclarée", () => {
    const plan = probePlan(
      serveur({
        declared: { protocol: "a2s", port_variable: "MON_PORT", port_offset: 1 },
        variables: { MON_PORT: "27100" },
      }),
    );
    expect(plan).toEqual({ protocol: "a2s", port: 27_100 });
  });

  it("applique le décalage quand la variable est vide ou invalide", () => {
    for (const valeur of [undefined, "", "abc", "70000", "0"]) {
      const plan = probePlan(
        serveur({
          declared: { protocol: "a2s", port_variable: "MON_PORT", port_offset: 1 },
          variables: valeur === undefined ? {} : { MON_PORT: valeur },
          port: 2456,
        }),
      );
      expect(plan).toEqual({ protocol: "a2s", port: 2457 });
    }
  });

  it("ne sonde pas un port hors limites", () => {
    expect(
      probePlan(serveur({ declared: { protocol: "a2s", port_offset: 1 }, port: 65_535 })),
    ).toBeNull();
  });

  it("retombe sur le nom quand la déclaration est illisible", () => {
    expect(probePlan(serveur({ eggName: "Paper", declared: { protocol: "gamespy" } }))).toEqual({
      protocol: "minecraft",
      port: 27_015,
    });
  });
});

describe("probePlan : jeux reconnus", () => {
  it.each([
    ["Minecraft (nom d'egg)", { eggName: "Paper", nestName: "Minecraft" }, "minecraft", 27_015],
    ["Rust", { eggName: "Rust", nestName: "Rust" }, "a2s", 27_015],
    ["Rust (démarrage)", { startup: "./RustDedicated -batchmode" }, "a2s", 27_015],
    ["Garry's Mod", { eggName: "Garrys Mod", nestName: "Source Engine" }, "a2s", 27_015],
    ["CS2", { eggName: "Counter-Strike 2", nestName: "Source Engine" }, "a2s", 27_015],
    ["srcds", { startup: "./srcds_run -game csgo" }, "a2s", 27_015],
    ["7 Days to Die", { eggName: "7 Days To Die", nestName: "Steam" }, "a2s", 27_015],
    ["Valheim, port + 1", { eggName: "Valheim", nestName: "Steam" }, "a2s", 27_016],
    ["FiveM", { eggName: "FiveM", nestName: "GTA" }, "cfx", 27_015],
    ["RedM", { eggName: "RedM", nestName: "Rockstar" }, "cfx", 27_015],
    [
      "FXServer (démarrage)",
      { startup: "$(pwd)/alpine/opt/cfx-server/ld-musl-x86_64.so.1 +exec server.cfg" },
      "cfx",
      27_015,
    ],
  ] as const)("%s", (_, partiel, protocol, port) => {
    expect(probePlan(serveur(partiel))).toEqual({ protocol, port });
  });

  it("prend le port de requête dans la variable du serveur", () => {
    expect(
      probePlan(serveur({ eggName: "Rust", variables: { QUERY_PORT: "28017" }, port: 28_015 })),
    ).toEqual({ protocol: "a2s", port: 28_017 });
    expect(
      probePlan(
        serveur({ eggName: "Valheim", variables: { STEAM_QUERY_PORT: " 2460 " }, port: 2456 }),
      ),
    ).toEqual({ protocol: "a2s", port: 2460 });
  });

  it("n'emploie qu'un port de variable alloué au serveur", () => {
    // Défaut : le client règle `QUERY_PORT` et le panel sondait n'importe quel
    // port de la machine à sa demande.
    expect(
      probePlan(serveur({ eggName: "Rust", variables: { QUERY_PORT: "22" }, port: 28_015 })),
    ).toEqual({ protocol: "a2s", port: 28_015 });
    expect(
      probePlan(serveur({ eggName: "ARK", variables: { QUERY_PORT: "5432" }, port: 7777 })),
    ).toBeNull();
    expect(
      probePlan(
        serveur({
          eggName: "Paper",
          declared: { protocol: "a2s", port_variable: "QP" },
          variables: { QP: "3306" },
          port: 27_015,
        }),
      ),
    ).toEqual({ protocol: "a2s", port: 27_015 });
  });

  it("ne devine pas le port de requête d'ARK", () => {
    // 27015 pour un jeu sur 7777 : sans la variable, sonder le port de jeu
    // déclarerait le serveur en panne chaque minute.
    expect(probePlan(serveur({ eggName: "ARK: Survival Evolved", port: 7777 }))).toBeNull();
    expect(
      probePlan(
        serveur({
          eggName: "ARK: Survival Evolved",
          port: 7777,
          variables: { QUERY_PORT: "27015" },
        }),
      ),
    ).toEqual({ protocol: "a2s", port: 27_015 });
  });

  it("n'emploie pas la variable de requête pour FiveM", () => {
    expect(
      probePlan(serveur({ eggName: "FiveM", variables: { QUERY_PORT: "40000" }, port: 30_120 })),
    ).toEqual({ protocol: "cfx", port: 30_120 });
  });

  it("ne sonde pas Minecraft Bedrock, qui ne parle pas le ping de Java", () => {
    expect(probePlan(serveur({ eggName: "Bedrock", nestName: "Minecraft" }))).toBeNull();
    expect(probePlan(serveur({ eggName: "PocketMine-MP", nestName: "Minecraft" }))).toBeNull();
  });

  it("ne sonde pas un jeu inconnu, ni un mot seulement contenu dans un autre", () => {
    expect(probePlan(serveur({ eggName: "Terraria", nestName: "Jeux" }))).toBeNull();
    expect(
      probePlan(serveur({ eggName: "Satisfactory", image: "ghcr.io/parkervcp/games:source" })),
    ).toBeNull();
    expect(probePlan(serveur({ eggName: "Serveur trusted", nestName: "Marked" }))).toBeNull();
  });
});
