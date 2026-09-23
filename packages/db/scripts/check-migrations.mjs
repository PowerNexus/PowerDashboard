/**
 * Vérifie que le schéma et les migrations sont en phase.
 *
 *   pnpm db:check
 *
 * **Pourquoi ne pas se contenter de `drizzle-kit generate` suivi d'un
 * `git diff`.** drizzle-kit pose une question interactive dès qu'il soupçonne
 * un renommage (« colonne créée ou renommée ? »). Sans terminal, il affiche
 * une erreur… et sort avec le code 0. Aucun fichier n'est écrit, le `git diff`
 * est vide, et la vérification passe sans avoir rien vérifié. C'est ainsi que
 * les migrations 0027 à 0037, écrites à la main sans instantané, sont restées
 * invisibles.
 *
 * On exige donc la phrase par laquelle drizzle-kit dit qu'il n'a rien trouvé.
 * Tout le reste — une migration produite, une question, une erreur — échoue.
 */
import { spawnSync } from "node:child_process";

const resultat = spawnSync("drizzle-kit", ["generate"], {
  encoding: "utf8",
  // Le schéma se lit sans base : une URL vide suffit, et évite qu'une
  // variable d'environnement locale fasse croire que la base est consultée.
  env: { ...process.env, DATABASE_URL: "" },
  shell: process.platform === "win32",
});
const sortie = `${resultat.stdout ?? ""}${resultat.stderr ?? ""}`;

if (resultat.status === 0 && sortie.includes("No schema changes")) {
  console.log("Schéma et migrations en phase.");
  process.exit(0);
}

console.error(sortie);
console.error(
  "Schéma et migrations ne sont pas en phase : drizzle-kit a produit une migration, " +
    "posé une question ou échoué. Voir docs/contribuer.md, « Modifier le schéma ».",
);
process.exit(1);
