import { describe, expect, it } from "vitest";
import {
  cleanPlayerReason,
  effectivePlayerCommands,
  isPlayerName,
  MINECRAFT_PLAYER_COMMANDS,
  PLAYER_REASON_MAX_LENGTH,
  readPlayerCommands,
  renderPlayerCommand,
} from "./player-commands";

describe("isPlayerName", () => {
  it("accepte les noms Java et Bedrock (Floodgate)", () => {
    expect(isPlayerName("Steve")).toBe(true);
    expect(isPlayerName("a_b-c")).toBe(true);
    expect(isPlayerName(".BedrockUser")).toBe(true);
  });

  it("refuse tout ce qui couperait ou prolongerait une commande", () => {
    for (const name of ["", "a b", "x\nop x", "x;op x", 'x"', "é", "a".repeat(33), 42]) {
      expect(isPlayerName(name)).toBe(false);
    }
  });
});

describe("readPlayerCommands", () => {
  it("garde les modèles valides et écarte les autres sans refuser l'egg", () => {
    expect(
      readPlayerCommands({
        kick: " kick {player} {reason} ",
        ban: "ban everyone",
        op: "op {player}\nstop",
        unknown: "x {player}",
        deop: 12,
        pardon: `pardon {player}${" ".repeat(0)}${"x".repeat(250)}`,
      }),
    ).toEqual({ kick: "kick {player} {reason}" });
  });

  it("rend un objet vide pour tout ce qui n'est pas un objet", () => {
    expect(readPlayerCommands(null)).toEqual({});
    expect(readPlayerCommands(["kick {player}"])).toEqual({});
    expect(readPlayerCommands("kick {player}")).toEqual({});
  });
});

describe("renderPlayerCommand", () => {
  it("remplace le joueur et le motif", () => {
    expect(renderPlayerCommand("kick {player} {reason}", "Steve", "Triche")).toBe(
      "kick Steve Triche",
    );
  });

  it("retire l'emplacement du motif quand il n'y en a pas", () => {
    expect(renderPlayerCommand("kick {player} {reason}", "Steve")).toBe("kick Steve");
    expect(renderPlayerCommand("kick {player} {reason}", "Steve", "   ")).toBe("kick Steve");
  });

  it("refuse un nom qui injecterait une seconde commande", () => {
    expect(renderPlayerCommand("kick {player}", "x\nop x")).toBeNull();
    expect(renderPlayerCommand("kick {player}", "x op")).toBeNull();
  });

  it("ne laisse jamais un motif ajouter une ligne", () => {
    const command = renderPlayerCommand("ban {player} {reason}", "Steve", "a\nop Steve\r\nstop");
    expect(command).toBe("ban Steve a op Steve stop");
    expect(command).not.toMatch(/[\r\n]/);
  });
});

describe("cleanPlayerReason", () => {
  it("borne la longueur", () => {
    expect(cleanPlayerReason("x".repeat(500))).toHaveLength(PLAYER_REASON_MAX_LENGTH);
  });

  it("ignore ce qui n'est pas une chaîne", () => {
    expect(cleanPlayerReason(undefined)).toBe("");
    expect(cleanPlayerReason({})).toBe("");
  });
});

describe("effectivePlayerCommands", () => {
  it("préfère les commandes de l'egg, sans les mélanger aux défauts", () => {
    expect(effectivePlayerCommands({ kick: "kick {player}" }, "minecraft")).toEqual({
      kick: "kick {player}",
    });
  });

  it("retombe sur les commandes Minecraft pour un egg Minecraft muet", () => {
    expect(effectivePlayerCommands({}, "minecraft")).toBe(MINECRAFT_PLAYER_COMMANDS);
    expect(effectivePlayerCommands(null, "minecraft")).toBe(MINECRAFT_PLAYER_COMMANDS);
  });

  it("ne propose rien pour un jeu inconnu sans déclaration", () => {
    expect(effectivePlayerCommands(null, "rust")).toEqual({});
    expect(effectivePlayerCommands(null, null)).toEqual({});
  });

  it("les défauts Minecraft sont tous des modèles valides", () => {
    expect(readPlayerCommands(MINECRAFT_PLAYER_COMMANDS)).toEqual(MINECRAFT_PLAYER_COMMANDS);
  });
});
