import type { Meta, StoryObj } from "@storybook/react-vite";
import { SERVER_STATE_META, ServerCard, type ServerCardState } from "./server-card";

const BASE = {
  name: "Survie 1.20",
  shortId: "31201e0c",
  address: "fr-01.exemple.fr:25565",
  nodeName: "fr-01",
  cpuPct: 34,
  memoryLabel: "2,1 Go / 4 Go",
  diskLabel: "6,4 Go / 10 Go",
  playersLabel: "7 / 40",
};

const meta = {
  title: "Organismes/ServerCard",
  component: ServerCard,
  args: { ...BASE, state: "running" as ServerCardState },
} satisfies Meta<typeof ServerCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EnMarche: Story = {};

/**
 * Tous les états, parce que c'est la liste des serveurs qui les montre.
 *
 * Un client en voit plusieurs à la fois, et doit distinguer d'un coup d'œil ce
 * qui tourne, ce qui travaille et ce qui est arrêté par l'hébergeur. La
 * pastille pulse pour les états **transitoires** uniquement : un point qui
 * clignote sur un serveur suspendu ferait attendre quelque chose qui
 * n'arrivera pas.
 */
export const TousLesEtats: Story = {
  render: () => (
    <div className="grid gap-4 sm:grid-cols-2">
      {(Object.keys(SERVER_STATE_META) as ServerCardState[]).map((state) => (
        <ServerCard key={state} {...BASE} state={state} name={`Serveur — ${state}`} />
      ))}
    </div>
  ),
};

/**
 * Les mesures manquantes.
 *
 * Un serveur arrêté ne consomme rien, et le daemon d'un node injoignable ne
 * rapporte rien : ce sont deux choses différentes, et aucune ne doit s'écrire
 * « 0 % ». Un zéro se lit comme « au repos », ce qui est faux dans le second
 * cas et trompeur dans le premier.
 */
export const SansMesure: Story = {
  args: {
    state: "offline",
    cpuPct: 0,
    memoryLabel: "— / 4 Go",
    diskLabel: "— / 10 Go",
    playersLabel: "—",
  },
};

export const Favori: Story = {
  args: { isFavorite: true, onToggleFavorite: () => undefined },
};

/** Avec le filigrane du jeu, tel que la liste le rend vraiment. */
export const AvecFiligrane: Story = {
  args: { backgroundUrl: "/brand/gamedashboard-logo.webp" },
};
