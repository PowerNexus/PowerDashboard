import type { Decorator, Preview } from "@storybook/react-vite";
import * as React from "react";
import "../src/styles/globals.css";

/**
 * Le thème n'est pas une classe CSS mais un attribut `data-theme` sur la racine
 * (voir `tokens.css`). Le décorateur le pose donc sur `documentElement`, comme
 * l'application : appliquer le thème à un conteneur intermédiaire donnerait des
 * rendus corrects en apparence tout en masquant les composants qui remontent au
 * document — dialogues, menus et infobulles Radix, qui sortent tous du portail.
 */
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme as string;

  React.useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-theme");
    root.setAttribute("data-theme", theme);
    return () => {
      if (previous) root.setAttribute("data-theme", previous);
      else root.removeAttribute("data-theme");
    };
  }, [theme]);

  return (
    <div className="bg-bg text-fg min-h-[6rem] p-6" data-theme={theme}>
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: "Thème appliqué au document",
      defaultValue: "dark",
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "light", title: "Clair" },
          { value: "dark", title: "Sombre" },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    // Aucun fond propre à Storybook : la couleur vient des tokens, sans quoi on
    // validerait des contrastes qui n'existent pas dans l'application.
    backgrounds: { disable: true },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: {
      // Signale sans bloquer : un rapport qui fait échouer la CI sur un cas
      // discutable finit par être désactivé, donc par ne plus rien protéger.
      test: "todo",
    },
  },
};

export default preview;
