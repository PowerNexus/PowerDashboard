import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { Card, CardBody, CardFooter, CardHeader, KeyValueGrid } from "./card";

const meta = {
  title: "Molécules/Card",
  component: Card,
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Simple: Story = {
  render: () => (
    <Card className="max-w-xl">
      <CardHeader title="Ressources" description="Ce que ce serveur a le droit de consommer." />
      <CardBody>
        <p className="text-muted text-sm">Le corps accueille n'importe quel contenu.</p>
      </CardBody>
    </Card>
  ),
};

/** Avec une action dans l'en-tête : le cas le plus fréquent du panel. */
export const AvecAction: Story = {
  render: () => (
    <Card className="max-w-xl">
      <CardHeader
        title="Sauvegardes"
        description="Trois sur cinq employées."
        actions={
          <Button size="sm" variant="secondary">
            Nouvelle sauvegarde
          </Button>
        }
      />
      <CardBody>
        <p className="text-muted text-sm">Liste des sauvegardes…</p>
      </CardBody>
      <CardFooter>
        <span className="text-faint text-xs">Dernière il y a deux heures.</span>
      </CardFooter>
    </Card>
  ),
};

/**
 * La grille clé/valeur, employée pour toutes les fiches.
 *
 * Deux colonnes par défaut. Une valeur absente s'écrit explicitement — un
 * tiret cadratin plutôt qu'une case vide, qui se lirait comme un bogue
 * d'affichage.
 */
export const GrilleCleValeur: Story = {
  render: () => (
    <Card className="max-w-xl">
      <CardHeader title="Identité" />
      <CardBody>
        <KeyValueGrid
          items={[
            { label: "Identifiant", value: "31201e0c" },
            { label: "Propriétaire", value: "alex@exemple.fr" },
            { label: "Machine", value: "fr-01 · 10.0.0.5" },
            { label: "Description", value: "—" },
          ]}
        />
      </CardBody>
    </Card>
  ),
};
