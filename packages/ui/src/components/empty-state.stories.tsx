import type { Meta, StoryObj } from "@storybook/react-vite";
import { Archive, Database, SearchX, ServerOff } from "lucide-react";
import { Button } from "./button";
import { EmptyState } from "./empty-state";

const meta = {
  title: "Molécules/EmptyState",
  component: EmptyState,
  args: {
    icon: <Archive />,
    title: "Aucune sauvegarde",
    description: "Ce serveur n'a encore rien sauvegardé.",
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Simple: Story = {};

export const AvecAction: Story = {
  args: { action: <Button size="sm">Créer une sauvegarde</Button> },
};

/**
 * Les trois vides ne se valent pas, et ne doivent pas se dire pareil.
 *
 * « Rien n'existe encore » invite à créer. « Rien ne correspond » invite à
 * élargir la recherche. « Rien ne répond » invite à attendre ou à prévenir. Un
 * écran vide qui dirait la même phrase dans les trois cas ferait chercher au
 * mauvais endroit — et c'est le défaut le plus fréquent des états vides.
 */
export const TroisSortesDeVide: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <EmptyState
        icon={<Database />}
        title="Aucune base de données"
        description="Créez-en une pour que votre serveur puisse y écrire."
        action={<Button size="sm">Créer une base</Button>}
      />
      <EmptyState
        icon={<SearchX />}
        title="Aucun résultat"
        description="Aucun serveur ne correspond à « minecra ». Essayez un terme plus court."
      />
      <EmptyState
        icon={<ServerOff />}
        title="Machine injoignable"
        description="Le daemon de fr-01 ne répond pas. La liste affichée date de sa dernière réponse."
      />
    </div>
  ),
};
