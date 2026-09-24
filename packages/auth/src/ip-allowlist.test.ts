import { describe, expect, it } from "vitest";
import { ipAllowed, isAllowlistEntry } from "./ip-allowlist";

/*
 * La liste d'adresses d'une clé d'API n'avait aucun test (audit ASVS, NC-64),
 * alors que c'est elle qui décide si une clé volée sert ailleurs que depuis
 * la machine prévue.
 */
describe("isAllowlistEntry", () => {
  it("accepte une adresse exacte, IPv4 ou IPv6", () => {
    expect(isAllowlistEntry("203.0.113.7")).toBe(true);
    expect(isAllowlistEntry("2001:db8::1")).toBe(true);
    expect(isAllowlistEntry(" 203.0.113.7 ")).toBe(true);
  });

  it("accepte un bloc CIDR dans les bornes de sa famille", () => {
    expect(isAllowlistEntry("203.0.113.0/24")).toBe(true);
    expect(isAllowlistEntry("203.0.113.7/32")).toBe(true);
    expect(isAllowlistEntry("2001:db8::/32")).toBe(true);
    expect(isAllowlistEntry("2001:db8::1/128")).toBe(true);
    expect(isAllowlistEntry("203.0.113.0/33")).toBe(false);
    expect(isAllowlistEntry("2001:db8::/129")).toBe(false);
  });

  /*
   * Non-régression (NC-37) : `0.0.0.0/0` était accepté. Il couvre toutes les
   * adresses : une clé « restreinte » par lui ne l'est pas, et l'écran
   * afficherait pourtant une restriction.
   */
  it("refuse un préfixe nul, qui ne restreindrait rien", () => {
    expect(isAllowlistEntry("0.0.0.0/0")).toBe(false);
    expect(isAllowlistEntry("203.0.113.7/0")).toBe(false);
    expect(isAllowlistEntry("::/0")).toBe(false);
    expect(isAllowlistEntry("0.0.0.0/1")).toBe(true);
  });

  it("refuse ce qui n'est pas une adresse", () => {
    for (const entree of [
      "",
      "tout",
      "999.1.1.1",
      "203.0.113",
      "203.0.113.7/",
      "203.0.113.7/24/8",
      "203.0.113.7/-1",
      "203.0.113.7/2a",
      "/24",
      ":::",
      "example.com",
    ]) {
      expect(isAllowlistEntry(entree), entree).toBe(false);
    }
  });
});

describe("ipAllowed", () => {
  it("laisse tout passer quand la liste est vide", () => {
    // Le défaut : une clé sans restriction. Le contraire rendrait toute clé
    // inutilisable dès sa création.
    expect(ipAllowed([], "203.0.113.7")).toBe(true);
    expect(ipAllowed([], null)).toBe(true);
  });

  it("refuse une adresse inconnue dès qu'une liste existe", () => {
    expect(ipAllowed(["203.0.113.7"], null)).toBe(false);
    expect(ipAllowed(["203.0.113.7"], "pas-une-adresse")).toBe(false);
  });

  it("compare une adresse exacte", () => {
    expect(ipAllowed(["203.0.113.7"], "203.0.113.7")).toBe(true);
    expect(ipAllowed(["203.0.113.7"], "203.0.113.8")).toBe(false);
  });

  it("compare les bits du préfixe, et eux seuls", () => {
    expect(ipAllowed(["203.0.113.0/24"], "203.0.113.200")).toBe(true);
    expect(ipAllowed(["203.0.113.0/24"], "203.0.114.1")).toBe(false);
    expect(ipAllowed(["10.0.0.0/8"], "10.255.3.4")).toBe(true);
    expect(ipAllowed(["10.0.0.0/8"], "11.0.0.1")).toBe(false);
  });

  it("reconnaît une IPv4 présentée à travers une pile IPv6", () => {
    // `::ffff:203.0.113.7` : la même machine selon le chemin réseau.
    expect(ipAllowed(["203.0.113.7"], "::ffff:203.0.113.7")).toBe(true);
    expect(ipAllowed(["203.0.113.0/24"], "::ffff:203.0.113.9")).toBe(true);
  });

  it("compare les IPv6 sous leur forme développée", () => {
    expect(ipAllowed(["2001:db8::1"], "2001:0db8:0000:0000:0000:0000:0000:0001")).toBe(true);
    expect(ipAllowed(["2001:db8::/32"], "2001:db8:ffff::42")).toBe(true);
    expect(ipAllowed(["2001:db8::/32"], "2001:db9::1")).toBe(false);
  });

  it("ne confond pas les familles", () => {
    expect(ipAllowed(["203.0.113.0/24"], "2001:db8::1")).toBe(false);
    expect(ipAllowed(["2001:db8::/32"], "203.0.113.7")).toBe(false);
  });

  it("accepte si une seule entrée de la liste correspond", () => {
    expect(ipAllowed(["198.51.100.1", "203.0.113.0/24"], "203.0.113.5")).toBe(true);
  });
});
