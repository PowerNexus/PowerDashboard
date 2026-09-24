import { describe, expect, it } from "vitest";
import { PROVISIONAL_PASSWORD_TTL_MS, passwordStanding, provisionalPassword } from "./provisional";

const NOW = new Date("2026-09-24T12:00:00.000Z");

describe("provisionalPassword", () => {
  it("tire au sort un secret qui expire", () => {
    const drawn = provisionalPassword(undefined, NOW);
    expect(drawn.imposed).toBe(false);
    // 24 octets en base64url : 32 caractères, 192 bits.
    expect(drawn.password).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(drawn.expiresAt?.getTime()).toBe(NOW.getTime() + PROVISIONAL_PASSWORD_TTL_MS);
    expect(provisionalPassword(undefined, NOW).password).not.toBe(drawn.password);
  });

  it("n'impose aucune échéance à un mot de passe choisi par l'opérateur", () => {
    // C'est celui de la CI, qui joue ensuite la connexion avec : le forcer au
    // changement casserait la suite, et ce n'est pas un secret initial tiré
    // par le panel.
    const chosen = provisionalPassword("Essai-E2E-2026!motdepasse", NOW);
    expect(chosen).toEqual({
      password: "Essai-E2E-2026!motdepasse",
      expiresAt: null,
      imposed: true,
    });
  });

  it("ignore un mot de passe imposé trop court, et tire au sort à sa place", () => {
    const drawn = provisionalPassword("court", NOW);
    expect(drawn.imposed).toBe(false);
    expect(drawn.password).not.toBe("court");
    expect(drawn.expiresAt).not.toBeNull();
  });
});

describe("passwordStanding", () => {
  it("distingue le mot de passe ordinaire, provisoire et expiré", () => {
    expect(passwordStanding(null, NOW)).toBe("valid");
    expect(passwordStanding("2026-09-24T12:00:01.000Z", NOW)).toBe("provisional");
    // L'échéance elle-même est déjà passée : pas de dernière seconde de grâce.
    expect(passwordStanding("2026-09-24T12:00:00.000Z", NOW)).toBe("expired");
    expect(passwordStanding("2026-09-20T08:00:00.000Z", NOW)).toBe("expired");
  });
});
