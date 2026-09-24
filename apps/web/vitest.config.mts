import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests unitaires de la couche web : ce qui a des règles et ne se voit pas à
 * l'écran — la vérification de `state` au retour d'une cérémonie OAuth, le
 * sort du cookie qui la porte.
 *
 * `e2e/` est exclu : ses `*.spec.ts` sont des parcours Playwright, joués contre
 * l'application construite, pas des tests Vitest.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Le marqueur des modules réservés au serveur lève à l'import hors de la
      // condition `react-server` de Next. Ces tests sont côté serveur par
      // construction : on lui substitue sa version inerte.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
