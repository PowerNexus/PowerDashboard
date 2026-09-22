import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, isLocale, matchAcceptLanguage, resolveLocale } from "./locale";

describe("isLocale", () => {
  it("reconnaît les langues prises en charge", () => {
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("en")).toBe(true);
  });

  it("refuse tout le reste", () => {
    expect(isLocale("de")).toBe(false);
    expect(isLocale("fr-CA")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(42)).toBe(false);
  });
});

describe("matchAcceptLanguage", () => {
  it("retient une langue exacte", () => {
    expect(matchAcceptLanguage("en")).toBe("en");
  });

  it("ramène une variante régionale sur sa langue de base", () => {
    // Afficher l'anglais à un Québécois parce qu'il annonce « fr-CA » serait le
    // contraire de ce qu'il demande.
    expect(matchAcceptLanguage("fr-CA")).toBe("fr");
    expect(matchAcceptLanguage("en-GB,en;q=0.9")).toBe("en");
  });

  it("respecte l'ordre de qualité plutôt que l'ordre d'écriture", () => {
    expect(matchAcceptLanguage("de;q=1.0,fr;q=0.2,en;q=0.8")).toBe("en");
  });

  it("ignore une langue explicitement refusée", () => {
    // « en;q=0 » signifie « surtout pas l'anglais » : la retenir irait contre
    // la demande du navigateur.
    expect(matchAcceptLanguage("en;q=0,fr;q=0.5")).toBe("fr");
  });

  it("ignore les langues inconnues et poursuit la liste", () => {
    expect(matchAcceptLanguage("de,es,fr")).toBe("fr");
  });

  it("renvoie null quand rien ne correspond", () => {
    expect(matchAcceptLanguage("de,es")).toBe(null);
    expect(matchAcceptLanguage("")).toBe(null);
    expect(matchAcceptLanguage(null)).toBe(null);
  });

  it("ne se laisse pas troubler par un en-tête malformé", () => {
    expect(() => matchAcceptLanguage(",,;q=,fr")).not.toThrow();
    expect(matchAcceptLanguage(",,;q=,fr")).toBe("fr");
  });

  it("tolère la casse", () => {
    expect(matchAcceptLanguage("EN-US")).toBe("en");
  });
});

describe("resolveLocale", () => {
  it("préfère la langue du compte à tout le reste", () => {
    // Un réglage enregistré doit suivre l'utilisateur d'une machine à l'autre,
    // sinon la préférence dans le profil ne sert à rien.
    expect(resolveLocale({ user: "en", cookie: "fr", acceptLanguage: "fr" })).toBe("en");
  });

  it("retombe sur le cookie quand le compte n'a rien choisi", () => {
    expect(resolveLocale({ user: null, cookie: "en", acceptLanguage: "fr" })).toBe("en");
  });

  it("retombe sur le navigateur quand rien n'est enregistré", () => {
    expect(resolveLocale({ acceptLanguage: "en-US,en;q=0.9" })).toBe("en");
  });

  it("retombe sur le français en dernier recours", () => {
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
    expect(resolveLocale({ user: "de", cookie: "es", acceptLanguage: "it" })).toBe(DEFAULT_LOCALE);
  });

  it("ignore une valeur invalide au lieu de la propager", () => {
    // Un cookie se modifie depuis le navigateur : une valeur arbitraire ne doit
    // jamais atteindre le chargement des catalogues.
    expect(resolveLocale({ cookie: "../../etc/passwd", acceptLanguage: "en" })).toBe("en");
  });
});
