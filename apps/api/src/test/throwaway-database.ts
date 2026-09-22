import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient, type Database } from "@gamedashboard/db";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/**
 * Base jetable pour les tests d'intégration.
 *
 * Une vraie base PostgreSQL, créée pour un fichier de tests et détruite après
 * lui. Ni Docker, ni conteneur éphémère : le serveur est déjà là, et créer une
 * base y coûte quelques millisecondes. Ajouter une dépendance à un démon
 * externe rendrait la suite impossible à lancer là où elle doit précisément
 * pouvoir tourner — sur le poste, sans cérémonie.
 *
 * Pourquoi une base réelle plutôt qu'une doublure : ce qu'on teste ici vit
 * dans des prédicats SQL. Une doublure vérifierait surtout qu'elle est
 * d'accord avec elle-même, et laisserait passer exactement les erreurs que ces
 * tests existent pour attraper — une comparaison de dates dans le mauvais
 * sens, un `null` qui ne se compare pas comme on croit, un index oublié.
 *
 * Les migrations sont jouées telles quelles : le schéma testé est donc celui
 * qui sera déployé, y compris les migrations de données.
 */
export interface ThrowawayDatabase {
  db: Database;
  /** Nom de la base créée, utile quand un test échoue et qu'on veut l'inspecter. */
  name: string;
  /** Ferme les connexions et détruit la base. Toujours appeler, même après échec. */
  drop(): Promise<void>;
}

/**
 * Y a-t-il un serveur PostgreSQL à disposition ?
 *
 * Les tests d'intégration s'abstiennent proprement quand il n'y en a pas, au
 * lieu d'échouer : une suite rouge faute de base ne dit rien sur le code, et
 * finit par être ignorée — ce qui vaut moins qu'un saut annoncé.
 */
export const HAS_DATABASE = Boolean(process.env.DATABASE_URL);

/** Raison affichée par Vitest quand la suite est sautée. */
export const NO_DATABASE_REASON =
  "DATABASE_URL absente : test d'intégration sauté (aucun serveur PostgreSQL à disposition).";

const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../../../packages/db/migrations", import.meta.url),
);

export async function createThrowawayDatabase(): Promise<ThrowawayDatabase> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error(NO_DATABASE_REASON);

  // Suffixe aléatoire : deux fichiers de tests lancés en parallèle par Vitest
  // ne doivent pas se marcher dessus, et un nom fixe laisserait la base d'un
  // run interrompu bloquer le suivant.
  const name = `gamedashboard_test_${randomBytes(6).toString("hex")}`;

  /**
   * `CREATE DATABASE` ne s'exécute pas depuis la base qu'on veut créer : on
   * passe par `postgres`, la base d'administration présente partout.
   */
  const admin = createClient(withDatabase(base, "postgres"));
  try {
    await admin.execute(sql.raw(`create database "${name}"`));
  } finally {
    await admin.$client.end();
  }

  const db = createClient(withDatabase(base, name));
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    db,
    name,
    async drop() {
      await db.$client.end();

      const cleaner = createClient(withDatabase(base, "postgres"));
      try {
        /**
         * Les connexions restantes sont coupées avant la suppression.
         *
         * PostgreSQL refuse de supprimer une base encore ouverte, et une
         * connexion oubliée par un test transformerait la fin de suite en
         * échec sans rapport avec ce qui était testé.
         */
        await cleaner.execute(
          sql.raw(
            `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${name}' and pid <> pg_backend_pid()`,
          ),
        );
        await cleaner.execute(sql.raw(`drop database if exists "${name}"`));
      } finally {
        await cleaner.$client.end();
      }
    },
  };
}

/** Remplace le nom de base d'une URL de connexion, en gardant tout le reste. */
function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}
