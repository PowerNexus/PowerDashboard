import { createClient } from "@gamedashboard/db";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createThrowawayDatabase, HAS_DATABASE } from "./throwaway-database";

/**
 * La base jetable se supprime même quand un test a oublié une connexion.
 *
 * Le nettoyage ne coupe plus que les connexions clientes du rôle des tests
 * (l'autovacuum, superutilisateur, le faisait échouer) : il doit toujours
 * couper celles-là, sans quoi `drop database` refuserait une base ouverte.
 */
describe.skipIf(!HAS_DATABASE)("base jetable", () => {
  it("se supprime malgré une connexion oubliée par un test", async () => {
    const throwaway = await createThrowawayDatabase();
    const url = new URL(process.env.DATABASE_URL as string);
    url.pathname = `/${throwaway.name}`;
    const oubliee = createClient(url.toString());
    await oubliee.execute(sql`select 1`);

    try {
      await throwaway.drop();
    } finally {
      await oubliee.$client.end().catch(() => undefined);
    }

    const admin = createClient(process.env.DATABASE_URL as string);
    try {
      const restantes = (await admin.execute(
        sql`select 1 from pg_database where datname = ${throwaway.name}`,
      )) as unknown as unknown[];
      expect(restantes).toHaveLength(0);
    } finally {
      await admin.$client.end();
    }
  }, 60_000);
});
