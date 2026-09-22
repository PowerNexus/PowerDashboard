/**
 * Écrit `openapi.json` à la racine du dépôt.
 *
 *   pnpm openapi
 *
 * Le fichier est **livré** plutôt que produit à la volée, pour deux raisons
 * qui n'ont rien à voir l'une avec l'autre :
 *
 * 1. un client qui génère son SDK ne doit pas avoir à démarrer le panel ;
 * 2. livré, il se compare. L'intégration continue régénère et refuse la
 *    construction si le résultat diffère — c'est ce qui rend impossible
 *    d'ajouter une route sans que la spécification suive.
 *
 * La sortie est triée et indentée de deux espaces : un document dont l'ordre
 * des clés varierait produirait une différence à chaque exécution, et le
 * contrôle ne dirait plus rien.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument } from "../src/openapi";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cible = join(racine, "openapi.json");

const document = buildOpenApiDocument();
writeFileSync(cible, `${JSON.stringify(document, null, 2)}\n`, "utf8");

const routes = Object.values(document.paths).reduce(
  (total, operations) => total + Object.keys(operations).length,
  0,
);
console.log(
  `openapi.json écrit : ${Object.keys(document.paths).length} chemins, ${routes} routes.`,
);
