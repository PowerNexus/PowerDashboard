import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests unitaires de l'interface : les **règles** de la couche web — ce que
 * les relais transmettent à l'API, ce qu'ils refusent, ce que la politique de
 * sécurité autorise, la vérification de `state` au retour d'une cérémonie
 * OAuth. Le rendu, lui, reste tenu par les parcours et les captures (`e2e/`),
 * que ce lanceur ne touche pas : ses `*.spec.ts` sont des tests Playwright.
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
  // Le tsconfig de Next dit `jsx: preserve` (Next compile lui-même) : ici,
  // c'est au lanceur de transformer le JSX d'une page qu'un test importe.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
