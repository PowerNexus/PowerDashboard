import { fileURLToPath } from "node:url";
import type { Database } from "@gamedashboard/db";
import { DATE_BIN_FUNCTION, migrateDatabase, UUID_FUNCTION } from "@gamedashboard/db/migrate";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterEach, describe, expect, it } from "vitest";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../test/throwaway-database";

/**
 * Le migrateur de l'archive autonome (`@gamedashboard/db/migrate`) contre
 * celui de drizzle-orm, sur le serveur de la suite.
 *
 * Il doit laisser exactement la même base et la même table de suivi : une
 * base migrée par l'un (drizzle-kit sur un serveur à soi) se poursuit avec
 * l'autre (l'hébergement autonome), et inversement. Le même fichier tourne
 * contre un PostgreSQL 9.6 (`DATABASE_URL` vers ce serveur), celui des
 * hébergements mutualisés qui n'ont pas suivi.
 */

const DOSSIER = fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));
const bases: ThrowawayDatabase[] = [];

async function vide(): Promise<Database> {
  const base = await createThrowawayDatabase({ migrate: false });
  bases.push(base);
  return base.db;
}

afterEach(async () => {
  for (const base of bases.splice(0)) await base.drop();
});

/** Tout ce qui décrit le schéma : colonnes, index, contraintes, déclencheurs. */
async function schema(db: Database) {
  return {
    colonnes: await db.execute(sql`
      select table_name, column_name, data_type, udt_name, column_default, is_nullable
      from information_schema.columns where table_schema = 'public' order by 1, 2`),
    index: await db.execute(sql`
      select indexname, indexdef from pg_indexes where schemaname = 'public' order by 1`),
    contraintes: await db.execute(sql`
      select conname, pg_get_constraintdef(c.oid) as definition
      from pg_constraint c join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'public' order by 1`),
    declencheurs: await db.execute(sql`
      select tgname from pg_trigger where not tgisinternal order by 1`),
    enumerations: await db.execute(sql`
      select t.typname, e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
      order by 1, e.enumsortorder`),
  };
}

const suivi = (db: Database) =>
  db.execute(sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at`);

describe.skipIf(!HAS_DATABASE)("migrateur de l'archive autonome (intégration)", () => {
  it.skipIf(!HAS_DATABASE)(
    "laisse la même base et le même suivi que drizzle-orm",
    async () => {
      const [lui, nous] = [await vide(), await vide()];
      const [{ version } = { version: "0" }] = await lui.execute<{ version: string }>(
        sql`select current_setting('server_version_num') as version`,
      );
      // drizzle-orm ne passe pas avant PostgreSQL 13 : c'est tout l'objet.
      if (Number(version) < 130000) return;

      await migrate(lui, { migrationsFolder: DOSSIER });
      await migrateDatabase(nous, DOSSIER);

      expect(await suivi(nous)).toEqual(await suivi(lui));
      expect(await schema(nous)).toEqual(await schema(lui));
    },
    120_000,
  );

  it.skipIf(!HAS_DATABASE)(
    "joue toutes les migrations, puis ne rejoue rien",
    async () => {
      const db = await vide();
      await migrateDatabase(db, DOSSIER);
      const apres = await suivi(db);
      expect(apres.length).toBeGreaterThanOrEqual(45);

      await migrateDatabase(db, DOSSIER);
      expect(await suivi(db)).toEqual(apres);
    },
    120_000,
  );

  it.skipIf(!HAS_DATABASE)(
    "tire, faute de gen_random_uuid(), des UUID de version 4 tous distincts",
    async () => {
      const db = await vide();
      // Sous un autre nom : le serveur de la suite a sans doute le vrai.
      await db.execute(sql.raw("create schema essai"));
      await db.execute(
        sql.raw(UUID_FUNCTION.replace("public.gen_random_uuid()", "essai.uuid_compatible()")),
      );
      const tirages = await db.execute<{ id: string }>(
        sql.raw("select essai.uuid_compatible()::text as id from generate_series(1, 5000)"),
      );
      const ids = tirages.map((t) => t.id);
      for (const id of ids) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
      expect(new Set(ids).size).toBe(ids.length);
    },
    60_000,
  );
  it.skipIf(!HAS_DATABASE)(
    "range les relevés dans les mêmes pas que date_bin(), faute de l'avoir",
    async () => {
      const db = await vide();
      const [{ version } = { version: "0" }] = await db.execute<{ version: string }>(
        sql`select current_setting('server_version_num') as version`,
      );
      await db.execute(sql.raw("create schema essai"));
      await db.execute(
        sql.raw(DATE_BIN_FUNCTION.replace("public.date_bin(", "essai.date_bin_compatible(")),
      );

      // Les pas de l'historique (de 5 min à 1 j), sur des instants quelconques,
      // y compris au passage d'une heure d'été et avant l'origine.
      const cas = await db.execute<{ pas: number; source: string; compatible: string }>(
        sql.raw(`
          select pas, source::text,
            essai.date_bin_compatible(make_interval(secs => pas), source, 'epoch'::timestamptz)::text as compatible
          from unnest(array[300, 900, 3600, 14400, 86400]) as pas,
            unnest(array[
              '2026-03-29 00:59:59.999+00', '2026-03-29 01:00:00+00', '2026-10-25 02:30:00+02',
              '2026-09-24 21:47:13.123456+00', '1969-12-31 23:58:00+00', '2000-01-01 00:00:00+00'
            ]::timestamptz[]) as source
        `),
      );
      expect(cas.length).toBe(30);
      for (const { pas, source, compatible } of cas) {
        const t = new Date(source).getTime();
        const attendu = Math.floor(t / (pas * 1000)) * pas * 1000;
        expect(new Date(compatible).getTime(), `${pas} s, ${source}`).toBe(attendu);
      }

      // Là où le serveur a le vrai, les deux s'accordent.
      if (Number(version) >= 140000) {
        const [{ ecarts } = { ecarts: -1 }] = await db.execute<{ ecarts: number }>(
          sql.raw(`
            select count(*)::int as ecarts
            from generate_series('2026-01-01'::timestamptz, '2026-12-31', interval '7 hours 13 minutes') as source,
              unnest(array[300, 3600, 14400, 86400]) as pas
            where essai.date_bin_compatible(make_interval(secs => pas), source, 'epoch')
              <> date_bin(make_interval(secs => pas), source, 'epoch')
          `),
        );
        expect(ecarts).toBe(0);
      }
    },
    60_000,
  );
});
