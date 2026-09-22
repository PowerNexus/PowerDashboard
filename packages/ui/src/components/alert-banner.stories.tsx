import type { Meta, StoryObj } from "@storybook/react-vite";
import { AlertBanner } from "./alert-banner";

const meta = {
  title: "Molécules/AlertBanner",
  component: AlertBanner,
  args: {
    title: "Application mobile",
    children: "Gérez vos serveurs depuis votre téléphone. Disponible sur iOS et Android.",
  },
} satisfies Meta<typeof AlertBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Accent: Story = {};

export const Variantes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <AlertBanner variant="accent" title="Annonce">
        Une nouvelle version du panel est disponible.
      </AlertBanner>
      <AlertBanner variant="success" title="Sauvegarde terminée">
        L'archive de survival-01 est prête au téléchargement.
      </AlertBanner>
      <AlertBanner variant="warning" title="Maintenance planifiée">
        Le node RYZEN-09 sera indisponible dimanche de 3 h à 5 h.
      </AlertBanner>
      <AlertBanner variant="danger" title="Échec d'installation">
        Le script de l'egg s'est terminé avec le code 1. Consultez le journal.
      </AlertBanner>
    </div>
  ),
};

/**
 * Seule une annonce peut être fermée. Un message d'erreur ne l'est pas : un
 * échec d'installation que l'on peut faire disparaître d'un clic sans rien
 * corriger sera fermé, puis oublié.
 */
export const Fermable: Story = {
  args: { dismissible: true },
};

export const SansTitre: Story = {
  args: { title: undefined, children: "Message court, sans titre." },
};
