import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Storybook reprend cette configuration. Tailwind 4 passe par son plugin Vite
 * et non par PostCSS : c'est ce qui permet de servir exactement la même feuille
 * de style que l'application, donc de voir les composants tels qu'ils sont en
 * production plutôt qu'une approximation.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
