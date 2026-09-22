import type { Meta, StoryObj } from "@storybook/react-vite";
import { Progress } from "./progress";

const meta = {
  title: "Atomes/Progress",
  component: Progress,
  args: { value: 42, label: "Mémoire employée" },
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Simple: Story = {};

export const Tons: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <Progress value={30} tone="accent" label="Trente pour cent" />
      <Progress value={60} tone="success" label="Soixante pour cent" />
      <Progress value={85} tone="warning" label="Quatre-vingt-cinq pour cent" />
      <Progress value={98} tone="danger" label="Quatre-vingt-dix-huit pour cent" />
    </div>
  ),
};

/**
 * Les bornes, qui comptent plus qu'elles n'en ont l'air.
 *
 * Une valeur négative ou au-delà du maximum arrive pour de vrai : un daemon
 * qui rapporte une consommation avant d'avoir fini de démarrer, un quota
 * abaissé sous la consommation déjà faite. La barre se borne d'elle-même
 * plutôt que de déborder de sa carte.
 *
 * Un maximum nul — un quota de zéro sauvegarde — ne divise pas par zéro : la
 * barre reste vide, ce qui est la lecture juste.
 */
export const Bornes: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <Progress value={-20} max={100} label="Valeur négative" />
      <Progress value={250} max={100} tone="danger" label="Au-delà du maximum" />
      <Progress value={3} max={0} label="Maximum nul" />
    </div>
  ),
};

/** Avec une unité réelle : ce que montre l'écran des ressources. */
export const Quota: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-2">
      <div className="flex justify-between text-sm">
        <span className="text-fg">Disque</span>
        <span className="text-muted tabular-nums">6,4 Go / 8 Go</span>
      </div>
      <Progress value={6.4} max={8} tone="warning" label="Disque employé" />
    </div>
  ),
};
