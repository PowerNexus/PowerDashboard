import { describe, expect, it } from "vitest";
import { normalizeSsoProfile, SsoProfileError } from "./sso";

describe("normalizeSsoProfile", () => {
  it("lit un profil OIDC standard", () => {
    expect(
      normalizeSsoProfile({
        sub: "1234567890",
        email: "alex@gamedashboard.fr",
        email_verified: true,
        given_name: "Alex",
        family_name: "Equipier",
      }),
    ).toEqual({
      subject: "1234567890",
      email: "alex@gamedashboard.fr",
      emailVerified: true,
      nameFirst: "Alex",
      nameLast: "Equipier",
    });
  });

  it("accepte les noms de champs des fournisseurs non OIDC", () => {
    const profile = normalizeSsoProfile({
      id: 42,
      mail: "alex@gamedashboard.fr",
      firstName: "Alex",
      lastName: "Equipier",
    });
    expect(profile.subject).toBe("42");
    expect(profile.email).toBe("alex@gamedashboard.fr");
  });

  it("découpe un nom unique faute de mieux", () => {
    const profile = normalizeSsoProfile({ sub: "x", name: "Alex Equipier Martin" });
    expect(profile.nameFirst).toBe("Alex");
    expect(profile.nameLast).toBe("Equipier Martin");
  });

  /**
   * Le contrôle qui protège des prises de compte : seul le fournisseur peut
   * affirmer qu'une adresse est vérifiée, et c'est cette affirmation seule qui
   * autorisera plus tard à rapprocher deux comptes.
   */
  it("ne suppose jamais une adresse vérifiée", () => {
    for (const claims of [
      { sub: "x", email: "a@b.fr" },
      { sub: "x", email: "a@b.fr", email_verified: false },
      { sub: "x", email: "a@b.fr", email_verified: "no" },
      { sub: "x", email: "a@b.fr", email_verified: 1 },
    ]) {
      expect(normalizeSsoProfile(claims).emailVerified).toBe(false);
    }
  });

  /**
   * `email_verified` atteste la revendication `email`, et elle seule (NC-27).
   *
   * `preferred_username` est souvent saisi par l'utilisateur lui-même : un
   * annuaire qui le laisse libre et répond `email_verified: true` pour une
   * autre adresse — ou sans adresse du tout — faisait rapprocher
   * `admin@…` déclaré à la main du compte de l'administrateur.
   */
  it("ne tient pour vérifiée que l'adresse venue de « email »", () => {
    for (const claims of [
      { sub: "x", preferred_username: "admin@gamedashboard.fr", email_verified: true },
      { sub: "x", mail: "admin@gamedashboard.fr", email_verified: true },
      { sub: "x", preferred_username: "admin@gamedashboard.fr", emailVerified: "true" },
    ]) {
      const profile = normalizeSsoProfile(claims);
      expect(profile.email).toBe("admin@gamedashboard.fr");
      expect(profile.emailVerified).toBe(false);
    }

    const profile = normalizeSsoProfile({
      sub: "x",
      email: "alex@gamedashboard.fr",
      preferred_username: "admin@gamedashboard.fr",
      email_verified: true,
    });
    expect(profile.email).toBe("alex@gamedashboard.fr");
    expect(profile.emailVerified).toBe(true);
  });

  it("accepte « true » en chaîne, que rendent certains fournisseurs", () => {
    // Avec une adresse : la revendication atteste `email`, elle n'a pas de
    // sens sans lui.
    expect(
      normalizeSsoProfile({ sub: "x", email: "a@b.fr", email_verified: "true" }).emailVerified,
    ).toBe(true);
  });

  it("refuse un profil sans identifiant stable", () => {
    // Se rabattre sur l'e-mail rattacherait les comptes à une valeur que le
    // fournisseur autorise à changer : deux personnes successives sur la même
    // adresse hériteraient du même compte panel.
    expect(() => normalizeSsoProfile({ email: "a@b.fr", name: "Alex" })).toThrow(SsoProfileError);
  });

  it("refuse ce qui n'est pas un objet", () => {
    for (const bad of [null, "texte", 42, undefined]) {
      expect(() => normalizeSsoProfile(bad)).toThrow(SsoProfileError);
    }
  });

  it("tolère un profil sans nom", () => {
    // Un libellé d'affichage manquant ne justifie pas de refuser une connexion.
    const profile = normalizeSsoProfile({ sub: "x", email: "a@b.fr" });
    expect(profile.nameFirst).toBe("");
    expect(profile.nameLast).toBe("");
  });
});
