import { createClient } from "@gamedashboard/db";
import { migrateDatabase } from "@gamedashboard/db/migrate";

/**
 * Migrateur de l'archive autonome (`api/migrer.cjs`).
 *
 *   node api/migrer.cjs <dossier des migrations>
 *
 * Sur un hébergement sans outils, drizzle-kit n'est pas là : c'est ce
 * migrateur, compilé dans chaque version, que la mise à jour automatique
 * lance avant de basculer. Il joue les migrations **de la version qui
 * arrive**, avec le migrateur qu'elle embarque (`@gamedashboard/db/migrate`) —
 * le même que celui des tests d'intégration (`test/throwaway-database.ts`),
 * qui tient la table de suivi de drizzle-kit (`drizzle.__drizzle_migrations`)
 * et accepte les PostgreSQL anciens des hébergements mutualisés (9.6).
 *
 * Seule `DATABASE_URL` lui est transmise, jamais la clé de chiffrement.
 */
async function main(): Promise<void> {
  const dossier = process.argv[2];
  if (!dossier) throw new Error("Usage : migrer.cjs <dossier des migrations>");

  const db = createClient();
  try {
    await migrateDatabase(db, dossier);
  } finally {
    await db.$client.end();
  }
}

main().then(
  () => process.exit(0),
  (erreur: unknown) => {
    console.error(erreur);
    process.exit(1);
  },
);
