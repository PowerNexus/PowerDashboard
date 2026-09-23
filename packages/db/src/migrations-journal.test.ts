import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Le journal des migrations et ses instantanés.
 *
 * drizzle-kit compare le schéma au **dernier instantané**, pas à la base. Les
 * migrations 0027 à 0037 avaient été écrites à la main sans en produire :
 * drizzle-kit comparait donc le schéma à l'état d'avant 0027, voyait onze
 * migrations de différences, et s'arrêtait sur une question (« colonne créée
 * ou renommée ? ») — en sortant en succès. La vérification de la CI passait
 * sans avoir rien vérifié.
 */

const MIGRATIONS = join(import.meta.dirname, "..", "migrations");
const META = join(MIGRATIONS, "meta");

interface Journal {
  entries: { idx: number; tag: string }[];
}
interface Snapshot {
  id: string;
  prevId: string;
}

const journal = JSON.parse(readFileSync(join(META, "_journal.json"), "utf8")) as Journal;

describe("journal des migrations", () => {
  it("a un fichier SQL pour chaque entrée, et aucun fichier hors journal", () => {
    const attendus = journal.entries.map((e) => `${e.tag}.sql`).sort();
    const presents = readdirSync(MIGRATIONS)
      .filter((nom) => nom.endsWith(".sql"))
      .sort();

    expect(presents).toEqual(attendus);
  });

  it("a un instantané pour sa dernière migration", () => {
    // Non-régression : sans lui, drizzle-kit compare le schéma à un état
    // ancien, et toute migration écrite à la main depuis devient invisible.
    const derniere = journal.entries.at(-1);
    const fichier = `${String(derniere?.idx).padStart(4, "0")}_snapshot.json`;

    expect(existsSync(join(META, fichier)), `${fichier} manquant`).toBe(true);
  });

  it("chaîne ses instantanés sans trou ni doublon", () => {
    const instantanes = readdirSync(META)
      .filter((nom) => nom.endsWith("_snapshot.json"))
      .sort()
      .map((nom) => JSON.parse(readFileSync(join(META, nom), "utf8")) as Snapshot);

    const ids = instantanes.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [i, instantane] of instantanes.entries()) {
      if (i === 0) continue;
      expect(instantane.prevId).toBe(instantanes[i - 1]?.id);
    }
  });
});
