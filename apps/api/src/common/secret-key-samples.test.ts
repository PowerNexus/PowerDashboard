import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { MIN_SECRET_KEY_LENGTH } from "@gamedashboard/auth";
import { describe, expect, it } from "vitest";

/**
 * Les clés que le dépôt pose lui-même passent le seuil de l'API.
 *
 * `APP_SECRET_KEY` est refusée sous `MIN_SECRET_KEY_LENGTH` caractères (audit
 * ASVS, NC-19). Une clé d'essai trop courte dans un workflow ne se verrait
 * qu'au lancement de l'API par le job e2e, sur le runner ; un installateur qui
 * en tirerait une trop courte produirait une installation qui ne démarre pas.
 * Ce contrôle les lit toutes ici, sans rien lancer.
 */

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");

/** Parcours à la main : `node_modules` et les sorties de build ne sont pas descendus. */
function fichiers(dossier: string, suffixes: string[]): string[] {
  const trouves: string[] = [];
  const parcourir = (chemin: string): void => {
    for (const entree of readdirSync(chemin, { withFileTypes: true })) {
      if (entree.isDirectory()) {
        if (!["node_modules", ".next", "dist", ".turbo"].includes(entree.name)) {
          parcourir(join(chemin, entree.name));
        }
      } else if (suffixes.some((suffixe) => entree.name.endsWith(suffixe))) {
        trouves.push(join(chemin, entree.name));
      }
    }
  };
  parcourir(join(RACINE, dossier));
  return trouves;
}

describe("clés d'essai et clés générées", () => {
  it("les workflows posent une clé assez longue", () => {
    const valeurs = fichiers(".github/workflows", [".yml"]).flatMap((chemin) =>
      [...readFileSync(chemin, "utf8").matchAll(/APP_SECRET_KEY:\s*(\S+)/g)].map((m) => ({
        chemin: relative(RACINE, chemin),
        cle: m[1] as string,
      })),
    );
    expect(valeurs.length).toBeGreaterThan(0);
    for (const { chemin, cle } of valeurs) {
      expect(cle.length, chemin).toBeGreaterThanOrEqual(MIN_SECRET_KEY_LENGTH);
    }
  });

  it("les installateurs tirent assez d'octets", () => {
    const tirages = [
      ...fichiers("infra", [".sh"]),
      join(RACINE, ".claude", "cloud-setup.sh"),
    ].flatMap((chemin) =>
      [
        ...readFileSync(chemin, "utf8").matchAll(
          /APP_SECRET_KEY=\$\(openssl rand -base64 (\d+)\)/g,
        ),
      ].map((m) => ({ chemin: relative(RACINE, chemin), octets: Number(m[1]) })),
    );
    expect(tirages.length).toBeGreaterThan(0);
    for (const { chemin, octets } of tirages) {
      // base64 : quatre caractères pour trois octets.
      expect(Math.ceil(octets / 3) * 4, chemin).toBeGreaterThanOrEqual(MIN_SECRET_KEY_LENGTH);
    }
  });

  // Une chaîne suivie d'un appel (`"x".repeat(32)`) n'est pas la clé elle-même.
  it("les tests posent une clé assez longue", () => {
    const litterales = [
      ...fichiers("apps", [".test.ts"]),
      ...fichiers("packages", [".test.ts"]),
    ].flatMap((chemin) =>
      [
        ...readFileSync(chemin, "utf8").matchAll(
          /APP_SECRET_KEY(?::|\s*\?\?=|\s*=)\s*"([^"]*)"(?!\.)/g,
        ),
      ].map((m) => ({ chemin: relative(RACINE, chemin), cle: m[1] as string })),
    );
    expect(litterales.length).toBeGreaterThan(0);
    for (const { chemin, cle } of litterales) {
      expect(cle.length, `${chemin} : « ${cle} »`).toBeGreaterThanOrEqual(MIN_SECRET_KEY_LENGTH);
    }
  });
});
