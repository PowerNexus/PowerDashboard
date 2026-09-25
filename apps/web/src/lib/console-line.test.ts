import { describe, expect, it } from "vitest";
import { toConsoleLine } from "./console-line";

const ESC = "\u001B";

describe("ligne de console", () => {
  it("garde les couleurs du jeu et un texte nu pour la recherche", () => {
    const line = toConsoleLine(`${ESC}[33m[12:00 WARN]${ESC}[0m: lent`, undefined, "GameDashboard");
    expect(line.text).toBe("[12:00 WARN]: lent");
    expect(line.segments).toEqual([{ text: "[12:00 WARN]", color: "yellow" }, { text: ": lent" }]);
    expect(line.level).toBe("warn");
    expect(line.label).toBeUndefined();
  });

  it("fait d'une ligne du daemon une ligne du panel, étiquetée par la machine", () => {
    const line = toConsoleLine(
      `${ESC}[1m[Pterodactyl Daemon]:${ESC}[0m Checking server disk space usage`,
      undefined,
      "GameDashboard · node-1",
    );
    expect(line).toMatchObject({
      text: "Checking server disk space usage",
      source: "system",
      label: "GameDashboard · node-1",
      segments: undefined,
    });
  });

  it("donne à chaque ligne un identifiant distinct, même dans la même milliseconde", () => {
    const a = toConsoleLine("a", undefined, "x");
    const b = toConsoleLine("a", undefined, "x");
    expect(a.id).not.toBe(b.id);
  });
});
