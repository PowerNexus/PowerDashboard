import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Connexion PostgreSQL.
 *
 * L'URL n'est pas lue au chargement du module : un import de `@gamedashboard/db`
 * depuis un outil ou un test ne doit pas échouer parce qu'une variable
 * d'environnement manque. Elle est exigée au moment où une connexion est
 * réellement demandée.
 */
export function createDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL absente de l'environnement.");
  }
  return url;
}

export function createClient(url: string = createDatabaseUrl()) {
  const sql = postgres(url, {
    types: {},
    prepare: true,
    onnotice: () => {},
    // `DATABASE_SSL=require` : connexion chiffrée exigée, pour une base qui
    // n'est pas sur la même machine. Sans la variable, l'URL décide.
    ...(process.env.DATABASE_SSL === "require" ? { ssl: "require" as const } : {}),
    // Les horodatages sont tous en timestamptz : UTC est imposé côté session
    // pour que le fuseau de l'hôte n'influence jamais une lecture.
    connection: { TimeZone: "UTC" },
  });
  return drizzle(sql, { schema });
}

export type Database = ReturnType<typeof createClient>;
