import { describe, expect, it } from "vitest";
import {
  checkPasswordShape,
  identityFragments,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordStrength,
} from "./password";

describe("passwordStrength", () => {
  it("ne dit rien tant que rien n'est tapé", () => {
    expect(passwordStrength("")).toMatchObject({ verdict: "empty", level: 0 });
  });

  it("compte ce qui manque sous le minimum de la politique", () => {
    expect(passwordStrength("sept-ca")).toEqual({
      verdict: "too-short",
      level: 1,
      length: 7,
      minimum: PASSWORD_MIN_LENGTH,
    });
  });

  it("monte avec la longueur seule, sans règle de composition", () => {
    // La politique ne juge que la longueur : la jauge ne doit pas récompenser
    // « Motdepasse1! » d'avoir une majuscule et un symbole.
    expect(passwordStrength("a".repeat(PASSWORD_MIN_LENGTH)).verdict).toBe("acceptable");
    expect(passwordStrength("Motdepasse1!").verdict).toBe("acceptable");
    expect(passwordStrength("a".repeat(16)).verdict).toBe("good");
    expect(passwordStrength("cheval agrafe batterie").verdict).toBe("strong");
    expect(passwordStrength("cheval agrafe batterie").level).toBe(4);
  });

  it("compte les points de code, comme la politique", () => {
    expect(passwordStrength("🔑".repeat(PASSWORD_MIN_LENGTH - 1)).verdict).toBe("too-short");
    expect(passwordStrength("🔑".repeat(PASSWORD_MIN_LENGTH)).verdict).toBe("acceptable");
  });

  it("signale l'identité et la démesure, que l'API refuserait", () => {
    const identity = identityFragments("matheo@gamedashboard.fr", "Matheo", "Leduc");
    expect(passwordStrength("bonjour-matheo-2026", identity).verdict).toBe("contains-identity");
    expect(passwordStrength("a".repeat(PASSWORD_MAX_LENGTH + 1)).verdict).toBe("too-long");
  });

  it("ne dit jamais « acceptable » de ce que la politique refuse, ni l'inverse", () => {
    // La jauge est un confort, la politique la règle : les deux doivent
    // s'accorder sur ce qui passe, sans quoi l'écran promettrait un succès
    // que l'API démentirait.
    const identity = ["matheo"];
    const samples = [
      "",
      "court",
      "a".repeat(11),
      "a".repeat(12),
      "matheo-a-la-plage",
      "une phrase de passe assez longue",
      "a".repeat(PASSWORD_MAX_LENGTH),
      "a".repeat(PASSWORD_MAX_LENGTH + 1),
    ];
    for (const sample of samples) {
      const accepted = ["acceptable", "good", "strong"].includes(
        passwordStrength(sample, identity).verdict,
      );
      expect(accepted, sample).toBe(checkPasswordShape(sample, identity).length === 0);
    }
  });
});
