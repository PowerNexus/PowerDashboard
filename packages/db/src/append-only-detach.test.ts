import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Le journal en ajout seul doit laisser passer **tous** ses détachements.
 *
 * `activity_logs` est protégé par un déclencheur qui refuse tout UPDATE. Mais
 * ses références sont déclarées `on delete set null` : supprimer la ligne visée
 * fait poser NULL par Postgres, ce qui est un UPDATE. Le déclencheur doit donc
 * admettre ce cas précis, colonne par colonne — sinon la suppression échoue.
 *
 * Cela s'est produit **deux fois**, sur la même table :
 *
 * 1. `actor_id` : aucun compte ne se supprimait, parce que tout compte a une
 *    ligne de journal. Corrigé par la migration 0032.
 * 2. `server_id` : aucun serveur ne se supprimait, pour exactement la même
 *    raison. Découvert plus tard, corrigé par la 0035 — la 0032 n'avait admis
 *    qu'une colonne sur deux.
 *
 * Les deux fois, rien n'a signalé la panne : le typage est satisfait, le code
 * de l'API est correct, et le refus vient d'un déclencheur écrit trois
 * migrations plus tôt. On le découvre en essayant de supprimer quelque chose.
 *
 * Ce contrôle relie la déclaration et le déclencheur : toute colonne déclarée
 * `set null` doit être nommée dans la dernière définition de la fonction. Il ne
 * dit pas que le déclencheur est **juste** — aucune lecture de texte ne le
 * peut — mais il dit qu'aucune colonne n'a été oubliée. C'est précisément ce
 * qui a manqué.
 */

const RACINE = join(import.meta.dirname, "..");
const SCHEMA = join(RACINE, "src", "schema", "shared.ts");
const MIGRATIONS = join(RACINE, "migrations");

/** Les colonnes de `activity_logs` déclarées « set null » à la suppression. */
function colonnesDetachables(): string[] {
  const source = readFileSync(SCHEMA, "utf8");
  const debut = source.indexOf('pgTable(\n  "activity_logs"');
  expect(debut, "La table activity_logs est introuvable dans le schéma.").toBeGreaterThan(-1);

  const table = source.slice(debut, source.indexOf("\n);", debut));
  // La déclaration peut tenir sur plusieurs lignes, d'où le passe-partout ; il
  // s'arrête à la colonne suivante pour ne pas attribuer à l'une le « set null »
  // de l'autre.
  const declaration = /uuid\("([a-z_]+)"\)(?:(?!uuid\()[\s\S])*?onDelete:\s*"set null"/g;
  return [...table.matchAll(declaration)].map((trouve) => trouve[1] as string);
}

/**
 * La dernière migration qui (re)définit le déclencheur.
 *
 * C'est elle qui fait foi : les précédentes ont été remplacées par
 * `CREATE OR REPLACE`, et les lire donnerait l'état d'avant.
 */
function declencheur(): string {
  const fichiers = readdirSync(MIGRATIONS)
    .filter((nom) => nom.endsWith(".sql"))
    .sort()
    .reverse();

  for (const nom of fichiers) {
    const contenu = readFileSync(join(MIGRATIONS, nom), "utf8");
    if (contenu.includes("FUNCTION activity_logs_append_only()")) return contenu;
  }

  throw new Error("Aucune migration ne définit activity_logs_append_only().");
}

describe("journal en ajout seul", () => {
  const colonnes = colonnesDetachables();
  const fonction = declencheur();

  it("trouve les colonnes détachables", () => {
    // Une extraction cassée rendrait le test vert sans rien vérifier.
    expect(colonnes).toContain("actor_id");
    expect(colonnes).toContain("server_id");
  });

  it.each(colonnes)("admet le détachement de %s", (colonne) => {
    expect(
      fonction.includes(`OLD.${colonne} IS NOT NULL AND NEW.${colonne} IS NULL`),
      `La colonne « ${colonne} » est déclarée « on delete set null », mais le ` +
        "déclencheur ne l'admet pas : supprimer la ligne visée échouera avec " +
        "« activity_logs est en ajout seul ». Ajoutez-la à la fonction dans une " +
        "nouvelle migration.",
    ).toBe(true);
  });

  it("compare la ligne entière, et non colonne par colonne", () => {
    // Sans cette comparaison, un UPDATE pourrait détacher une référence **et**
    // réécrire l'événement dans le même geste : le journal cesserait de dire ce
    // qui s'est passé, ce qui est sa seule raison d'être.
    expect(fonction).toContain("NEW IS NOT DISTINCT FROM detache");
  });
});
