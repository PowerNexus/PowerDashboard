import { describe, expect, it } from "vitest";
import { generateRecoveryCodes, normalizeRecoveryCode, RECOVERY_CODE_COUNT } from "./recovery";

describe("generateRecoveryCodes", () => {
  it("engendre le nombre attendu", () => {
    expect(generateRecoveryCodes()).toHaveLength(RECOVERY_CODE_COUNT);
    expect(generateRecoveryCodes(3)).toHaveLength(3);
  });

  it("n'emploie aucun caractère confondable", () => {
    // Ces codes se recopient à la main depuis un papier, souvent dans
    // l'urgence : un O pris pour un zéro fait accuser le code.
    const codes = generateRecoveryCodes(200).join("");
    for (const confusable of ["I", "O", "0", "1"]) {
      expect(codes).not.toContain(confusable);
    }
  });

  it("ne répète pas un code dans un lot", () => {
    const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("donne des lots différents d'un appel à l'autre", () => {
    expect(generateRecoveryCodes()).not.toEqual(generateRecoveryCodes());
  });

  it("garde un format lisible et constant", () => {
    for (const code of generateRecoveryCodes()) {
      expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    }
  });
});

describe("normalizeRecoveryCode", () => {
  it("ramène à la forme hachée, quelle que soit la saisie", () => {
    // Le tiret n'est qu'une aide à la lecture : refuser un code recopié sans
    // lui ferait croire à un code invalide.
    const canonical = normalizeRecoveryCode("ABCDE-FGHJK");
    for (const variant of ["abcde-fghjk", "ABCDEFGHJK", "abcde fghjk", " ABCDE - FGHJK "]) {
      expect(normalizeRecoveryCode(variant)).toBe(canonical);
    }
  });
});
