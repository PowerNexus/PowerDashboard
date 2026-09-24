import { describe, expect, it } from "vitest";
import {
  ALERT_AFTER_ATTEMPTS,
  attemptDelayMs,
  MAX_ATTEMPTS_PER_ACCOUNT,
  MAX_ATTEMPTS_PER_IP,
  shouldAlertOwner,
  throttleDecision,
} from "./throttle";

describe("attemptDelayMs", () => {
  it("ne pénalise pas les deux premières erreurs", () => {
    // Se tromper deux fois de mot de passe est humain, pas suspect.
    expect(attemptDelayMs(0)).toBe(0);
    expect(attemptDelayMs(1)).toBe(0);
    expect(attemptDelayMs(2)).toBe(0);
  });

  it("croît ensuite de façon exponentielle", () => {
    expect(attemptDelayMs(3)).toBe(250);
    expect(attemptDelayMs(4)).toBe(500);
    expect(attemptDelayMs(5)).toBe(1_000);
  });

  it("plafonne, pour ne pas immobiliser une requête", () => {
    expect(attemptDelayMs(50)).toBe(5_000);
  });
});

describe("throttleDecision", () => {
  it("laisse passer un utilisateur normal", () => {
    expect(throttleDecision({ account: 0, ip: 0 })).toEqual({ action: "allow", delayMs: 0 });
  });

  it("bloque après trop d'échecs sur un compte", () => {
    const decision = throttleDecision({ account: MAX_ATTEMPTS_PER_ACCOUNT, ip: 0 });
    expect(decision).toMatchObject({ action: "block", reason: "account" });
  });

  it("bloque une IP qui pilonne plusieurs comptes différents", () => {
    // Chaque compte n'a qu'un seul échec : la limite par compte ne verrait rien.
    const decision = throttleDecision({ account: 1, ip: MAX_ATTEMPTS_PER_IP });
    expect(decision).toMatchObject({ action: "block", reason: "ip" });
  });

  it("tolère plus d'échecs par IP que par compte", () => {
    // Un bureau ou un foyer partage une adresse publique : aligner les deux
    // seuils reviendrait à bloquer des utilisateurs légitimes.
    expect(MAX_ATTEMPTS_PER_IP).toBeGreaterThan(MAX_ATTEMPTS_PER_ACCOUNT);
    expect(throttleDecision({ account: 0, ip: MAX_ATTEMPTS_PER_ACCOUNT })).toMatchObject({
      action: "allow",
    });
  });

  it("ne verrouille pas le compte pour une adresse d'où il a déjà été ouvert", () => {
    // Sans cette exemption, n'importe qui enferme dehors n'importe quel
    // titulaire en échouant dix fois sur son adresse.
    expect(
      throttleDecision({ account: MAX_ATTEMPTS_PER_ACCOUNT, ip: 0, knownIp: true }),
    ).toMatchObject({ action: "allow" });
  });

  it("garde la limite par adresse, même pour une adresse connue", () => {
    expect(throttleDecision({ account: 0, ip: MAX_ATTEMPTS_PER_IP, knownIp: true })).toMatchObject({
      action: "block",
      reason: "ip",
    });
  });

  it("retient le plus restrictif des deux compteurs pour le délai", () => {
    expect(throttleDecision({ account: 1, ip: 5 })).toEqual({ action: "allow", delayMs: 1_000 });
  });
});

describe("shouldAlertOwner", () => {
  it("prévient au franchissement du seuil", () => {
    expect(shouldAlertOwner(ALERT_AFTER_ATTEMPTS)).toBe(true);
  });

  it("ne prévient pas avant", () => {
    expect(shouldAlertOwner(ALERT_AFTER_ATTEMPTS - 1)).toBe(false);
  });

  it("n'envoie pas un e-mail à chaque échec suivant", () => {
    // Sans cette égalité stricte, une attaque de mille tentatives enverrait
    // mille e-mails, ce qui transforme l'alerte en nuisance et la fait ignorer.
    expect(shouldAlertOwner(ALERT_AFTER_ATTEMPTS + 1)).toBe(false);
    expect(shouldAlertOwner(ALERT_AFTER_ATTEMPTS + 50)).toBe(false);
  });
});
