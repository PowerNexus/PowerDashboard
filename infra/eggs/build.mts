/**
 * Assemble les eggs livrés avec le panel.
 *
 *   pnpm eggs:build
 *
 * Chaque egg vit en deux fichiers : `egg.base.json` pour sa définition, et
 * `install.sh` pour son script d'installation. Ce script insère le second dans
 * le premier et écrit `egg.json`, qui est le fichier à importer.
 *
 * **Pourquoi deux fichiers.** Un script shell de trois cents lignes noyé dans
 * une chaîne JSON ne se relit pas, ne se colore pas, ne se vérifie pas par
 * `bash -n`, et chaque retour à la ligne y devient un `\n` qu'on finit par
 * mettre au mauvais endroit. Le format d'échange des eggs impose cette forme ;
 * rien n'oblige à l'écrire à la main.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const racine = dirname(fileURLToPath(import.meta.url));

for (const entree of readdirSync(racine)) {
  const dossier = join(racine, entree);
  if (!statSync(dossier).isDirectory()) continue;

  const base = join(dossier, "egg.base.json");
  const script = join(dossier, "install.sh");
  const cible = join(dossier, "egg.json");

  const definition = JSON.parse(readFileSync(base, "utf8")) as {
    _comment?: string;
    scripts: { installation: { script: string } };
  };

  // Le commentaire explique la construction : il n'a rien à faire dans le
  // fichier produit, que d'autres panels liront peut-être.
  definition._comment = undefined;
  definition.scripts.installation.script = readFileSync(script, "utf8");

  writeFileSync(cible, `${JSON.stringify(definition, null, 2)}\n`, "utf8");
  console.log(`${entree}/egg.json écrit.`);
}
