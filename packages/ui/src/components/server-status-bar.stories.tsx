import type { Meta, StoryObj } from "@storybook/react-vite";
import { ServerStatusBar } from "./server-status-bar";

const MESURES = [
  { label: "Processeur", value: 34, max: 100, format: (v: number) => `${v.toFixed(1)} %` },
  { label: "Mémoire", value: 2.1, max: 4, format: (v: number) => `${v.toFixed(1)} Go` },
  { label: "Disque", value: 6.4, max: 10, format: (v: number) => `${v.toFixed(1)} Go` },
];

const meta = {
  title: "Organismes/ServerStatusBar",
  component: ServerStatusBar,
  args: {
    name: "Survie 1.20",
    address: "fr-01.exemple.fr:25565",
    stateLabel: "En ligne",
    tone: "success" as const,
    metrics: MESURES,
  },
} satisfies Meta<typeof ServerStatusBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EnMarche: Story = {};

/**
 * **Aucune mesure n'est arrivée, et la barre le dit.**
 *
 * C'est le cas des premières secondes — le websocket n'est pas encore ouvert —
 * et celui d'un node injoignable. `value: null` rend la barre en hachures.
 * Écrire « 0 % » serait une affirmation, et elle serait fausse : on ne sait
 * pas que rien ne consomme, on sait qu'on n'a rien reçu.
 *
 * C'est pour cette raison que le type de `value` accepte `null` : sans cela,
 * chaque point d'appel écrirait `?? 0` par réflexe.
 */
export const SansMesure: Story = {
  args: {
    stateLabel: "Connexion…",
    tone: "neutral",
    pulse: true,
    metrics: MESURES.map((m) => ({ ...m, value: null })),
  },
};

export const Etats: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <ServerStatusBar
        name="En ligne"
        address="fr-01:25565"
        stateLabel="En ligne"
        tone="success"
        metrics={MESURES}
      />
      <ServerStatusBar
        name="Démarrage"
        address="fr-01:25566"
        stateLabel="Démarrage"
        tone="warning"
        pulse
        metrics={MESURES.map((m) => ({ ...m, value: null }))}
      />
      <ServerStatusBar
        name="Hors ligne"
        address="fr-01:25567"
        stateLabel="Hors ligne"
        tone="danger"
        metrics={MESURES.map((m) => ({ ...m, value: 0 }))}
      />
    </div>
  ),
};

/** Avec le panneau déplié : c'est là que vivent les graphes de la console. */
export const Depliee: Story = {
  args: {
    defaultOpen: true,
    children: (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-24 rounded-field border border-border bg-surface-2" />
        <div className="h-24 rounded-field border border-border bg-surface-2" />
      </div>
    ),
  },
};
