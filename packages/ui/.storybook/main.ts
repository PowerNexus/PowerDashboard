import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  // Les histoires vivent à côté des composants et non dans un dossier séparé :
  // renommer un composant sans son histoire devient impossible à oublier.
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y"],
  framework: { name: "@storybook/react-vite", options: {} },
  // Le design system est publié en sortie statique : aucun serveur à maintenir
  // pour que l'équipe le consulte.
  docs: { defaultName: "Documentation" },
  core: {
    // Rien ne sort de la machine sans raison, comme pour Turbo et Next en CI.
    disableTelemetry: true,
  },
  typescript: {
    /**
     * `react-docgen` et non `react-docgen-typescript`.
     *
     * Le second lit les types réels et produit de meilleurs tableaux de props,
     * mais il passe par les API du compilateur TypeScript, qui ont changé en
     * TS 7 : il échoue au démarrage sur « Cannot read properties of undefined
     * (reading 'fileExists') ». `react-docgen` analyse la syntaxe et s'en
     * passe. Conséquence à connaître : la documentation des props vient des
     * commentaires et des valeurs par défaut, pas de l'inférence de types.
     *
     * À rebasculer dès que le plugin suit TypeScript 7.
     */
    reactDocgen: "react-docgen",
  },
};

export default config;
