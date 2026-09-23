import { describe, expect, it } from "vitest";
import { segments } from "./chart";

const x = (i: number) => i * 10;
const y = (v: number) => 100 - v;

describe("segments", () => {
  it("trace une série continue d'un seul tenant", () => {
    const traits = segments(
      [
        { t: 0, v: 10 },
        { t: 1, v: 20 },
      ],
      x,
      y,
      100,
    );
    expect(traits.map((t) => t.path)).toEqual(["M0.0,90.0 L10.0,80.0"]);
  });

  it("interrompt la courbe sur un trou au lieu de le relier ou de le mettre à zéro", () => {
    const traits = segments(
      [
        { t: 0, v: 10 },
        { t: 1, v: 20 },
        { t: 2, v: null },
        { t: 3, v: 30 },
        { t: 4, v: 40 },
      ],
      x,
      y,
      100,
    );
    expect(traits.map((t) => t.path)).toEqual(["M0.0,90.0 L10.0,80.0", "M30.0,70.0 L40.0,60.0"]);
    // L'aire de chaque tronçon se referme sous lui seul : rien n'est peint
    // sous le trou.
    expect(traits[0]?.area).toContain("L10.0,100 L0.0,100 Z");
  });

  it("garde visible un relevé isolé entre deux trous", () => {
    const traits = segments(
      [
        { t: 0, v: null },
        { t: 1, v: 50 },
        { t: 2, v: null },
      ],
      x,
      y,
      100,
    );
    expect(traits).toHaveLength(1);
  });

  it("ne trace rien quand rien n'a été mesuré", () => {
    expect(segments([{ t: 0, v: null }], x, y, 100)).toEqual([]);
  });
});
