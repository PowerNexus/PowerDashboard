import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  // Les migrations sont relues avant application : aucune n'est jouée
  // automatiquement au démarrage d'un service.
  strict: true,
  verbose: true,
});
