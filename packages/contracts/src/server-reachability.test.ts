import { describe, expect, it } from "vitest";
import { outageDuration, reachabilityTransition } from "./server-reachability";

describe("reachabilityTransition", () => {
  it("ne déclare rien sur une seule sonde manquée", () => {
    expect(reachabilityTransition([false, true, true], false)).toBe(null);
  });

  it("déclare la panne après trois sondes manquées d'affilée", () => {
    expect(reachabilityTransition([false, false, false], false)).toBe("down");
  });

  it("attend d'avoir trois sondes avant de conclure", () => {
    expect(reachabilityTransition([false, false], false)).toBe(null);
  });

  it("ne redéclare pas une panne déjà connue", () => {
    expect(reachabilityTransition([false, false, false], true)).toBe(null);
  });

  it("déclare le retour dès la première réponse", () => {
    expect(reachabilityTransition([true, false, false], true)).toBe("up");
  });

  it("ne dit rien sans sonde", () => {
    expect(reachabilityTransition([], true)).toBe(null);
  });
});

describe("outageDuration", () => {
  const debut = new Date("2026-09-25T10:00:00Z");
  it.each([
    ["2026-09-25T10:00:20Z", "1 min"],
    ["2026-09-25T10:42:00Z", "42 min"],
    ["2026-09-25T12:00:00Z", "2 h"],
    ["2026-09-25T12:05:00Z", "2 h 5 min"],
  ])("jusqu'à %s : %s", (fin, attendu) => {
    expect(outageDuration(debut, new Date(fin))).toBe(attendu);
  });
});
