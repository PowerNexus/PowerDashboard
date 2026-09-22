import { describe, expect, it } from "vitest";
import { compareVersions, isOutdated, latestVersion } from "./version";

describe("compareVersions", () => {
  it("ordonne les versions numériquement, pas alphabétiquement", () => {
    expect(compareVersions("0.4.2", "0.4.1")).toBeGreaterThan(0);
    expect(compareVersions("0.4.1", "0.4.2")).toBeLessThan(0);
    expect(compareVersions("0.4.2", "0.4.2")).toBe(0);
  });

  it("compare 10 comme supérieur à 9, là où un tri de chaînes échouerait", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
  });

  it("complète les segments manquants par zéro", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.1")).toBeLessThan(0);
  });

  it("absorbe un préfixe textuel au lieu de produire NaN", () => {
    // Régression : avec « forge 0.4.2 » en entrée, la soustraction donnait NaN.
    // Comme NaN < 0 est faux, aucun node n'était jamais signalé en retard.
    expect(compareVersions("forge 0.4.0", "forge 0.4.2")).toBeLessThan(0);
    expect(compareVersions("v1.0.0", "v0.9.0")).toBeGreaterThan(0);
  });

  it("ignore un suffixe de pré-publication", () => {
    expect(compareVersions("1.0.0-rc1", "1.0.0")).toBe(0);
    expect(compareVersions("1.1.0-beta", "1.0.0")).toBeGreaterThan(0);
  });

  it("ne renvoie jamais NaN, même sans aucun chiffre", () => {
    expect(Number.isNaN(compareVersions("abc", "def"))).toBe(false);
    expect(compareVersions("abc", "def")).toBe(0);
  });
});

describe("latestVersion", () => {
  it("retient la plus récente indépendamment de l'ordre d'entrée", () => {
    expect(latestVersion(["0.4.0", "0.4.2", "0.4.1"])).toBe("0.4.2");
    expect(latestVersion(["0.4.2", "0.4.0"])).toBe("0.4.2");
  });

  it("renvoie une chaîne vide pour une liste vide", () => {
    expect(latestVersion([])).toBe("");
  });

  it("gère une liste à un seul élément", () => {
    expect(latestVersion(["0.4.1"])).toBe("0.4.1");
  });
});

describe("isOutdated", () => {
  it("ne signale que les versions strictement antérieures", () => {
    expect(isOutdated("0.4.0", "0.4.2")).toBe(true);
    expect(isOutdated("0.4.2", "0.4.2")).toBe(false);
    expect(isOutdated("0.5.0", "0.4.2")).toBe(false);
  });
});
