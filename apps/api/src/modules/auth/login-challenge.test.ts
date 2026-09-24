import { describe, expect, it } from "vitest";
import { CHALLENGE_TTL_MS, issueChallenge, readChallenge } from "./login-challenge";

process.env.APP_SECRET_KEY ??= "clé de test des défis de connexion";

const USER = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-09-16T12:00:00.000Z");

describe("défis scellés", () => {
  it("rend le compte qu'il désigne", () => {
    const token = issueChallenge("login", USER, { now: NOW });
    expect(readChallenge("login", token, NOW + 1000)).toEqual({
      userId: USER,
      webauthn: null,
      method: null,
      // L'identifiant à consommer en base, et l'échéance de sa trace.
      jti: expect.stringMatching(/^[0-9a-f-]{36}$/),
      expiresAt: NOW + CHALLENGE_TTL_MS,
      parent: null,
    });
  });

  it("scelle le chemin d'entrée jusqu'au second facteur", () => {
    // La session ouverte après un code à six chiffres doit dire « SSO » quand
    // l'entrée s'est faite par SSO : les deux chemins aboutissent à la même
    // route, et rien d'autre ne permet de les distinguer ensuite.
    const token = issueChallenge("login", USER, { method: "sso", now: NOW });
    expect(readChallenge("login", token, NOW)?.method).toBe("sso");
  });

  it("scelle le défi de connexion d'où dérive une cérémonie", () => {
    // NC-32 : la cérémonie de clé d'accès doit consommer le défi `login`
    // qui l'a ouverte, et le navigateur ne renvoie qu'elle.
    const login = readChallenge("login", issueChallenge("login", USER, { now: NOW }), NOW);
    if (!login) throw new Error("défi illisible");
    const token = issueChallenge("passkey-login", USER, {
      webauthn: "abc123",
      parent: { jti: login.jti, expiresAt: login.expiresAt },
      now: NOW,
    });
    expect(readChallenge("passkey-login", token, NOW)?.parent).toEqual({
      jti: login.jti,
      expiresAt: login.expiresAt,
    });
  });

  it("transporte le défi aléatoire d'une cérémonie WebAuthn", () => {
    const token = issueChallenge("passkey-register", USER, { webauthn: "abc123", now: NOW });
    expect(readChallenge("passkey-register", token, NOW)?.webauthn).toBe("abc123");
  });

  /**
   * Le contrôle qui compte : un défi obtenu pour **enregistrer** une clé ne
   * doit pas servir à **s'authentifier** avec. Sans la nature scellée, rien ne
   * distinguerait les deux une fois chiffrés.
   */
  it("refuse un jeton émis pour une autre cérémonie", () => {
    const token = issueChallenge("passkey-register", USER, { now: NOW });
    expect(readChallenge("passkey-login", token, NOW)).toBeNull();
    expect(readChallenge("login", token, NOW)).toBeNull();
  });

  it("ne laisse pas l'identifiant en clair dans le jeton", () => {
    // Un défi traîne dans un champ de formulaire et dans les journaux du
    // navigateur : il ne doit rien apprendre sur le compte visé.
    expect(issueChallenge("login", USER, { now: NOW })).not.toContain(USER);
  });

  it("expire", () => {
    const token = issueChallenge("login", USER, { now: NOW });
    expect(readChallenge("login", token, NOW + CHALLENGE_TTL_MS - 1)).not.toBeNull();
    expect(readChallenge("login", token, NOW + CHALLENGE_TTL_MS)).toBeNull();
  });

  it("refuse un jeton altéré d'un seul caractère", () => {
    // C'est tout l'intérêt du chiffrement authentifié : sans lui, il suffirait
    // de retoucher l'identifiant pour se faire passer pour un autre compte.
    const token = issueChallenge("login", USER, { now: NOW });
    const tampered = `${token.slice(0, -1)}${token.at(-1) === "A" ? "B" : "A"}`;
    expect(readChallenge("login", tampered, NOW)).toBeNull();
  });

  it("refuse n'importe quoi sans lever d'exception", () => {
    for (const bad of ["", "pas-un-jeton", "a.b.c", "{}"]) {
      expect(readChallenge("login", bad, NOW)).toBeNull();
    }
  });

  it("donne deux jetons différents pour le même compte", () => {
    // Le nonce du chiffrement change à chaque appel : deux défis identiques
    // laisseraient voir qu'il s'agit du même compte.
    expect(issueChallenge("login", USER, { now: NOW })).not.toBe(
      issueChallenge("login", USER, { now: NOW }),
    );
  });
});
