import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusDot, type StatusTone } from "./status-dot";

const meta = {
  title: "Atomes/StatusDot",
  component: StatusDot,
  args: { tone: "success", label: "En ligne" },
} satisfies Meta<typeof StatusDot>;

export default meta;
type Story = StoryObj<typeof meta>;

const TONES: { tone: StatusTone; label: string }[] = [
  { tone: "success", label: "En ligne" },
  { tone: "warning", label: "Démarrage" },
  { tone: "danger", label: "Hors ligne" },
  { tone: "info", label: "Installation" },
  { tone: "neutral", label: "Inconnu" },
];

export const EnLigne: Story = {};

export const Tonalites: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {TONES.map(({ tone, label }) => (
        <span key={tone} className="flex items-center gap-2 text-sm">
          <StatusDot tone={tone} label={label} />
          {label}
        </span>
      ))}
    </div>
  ),
};

/**
 * La pulsation signale une transition en cours — démarrage, arrêt — et non un
 * état stable. L'animer en permanence lui ferait perdre tout sens.
 */
export const Transition: Story = {
  args: { tone: "warning", pulse: true, label: "Démarrage en cours" },
};

/**
 * La couleur seule ne suffit pas : environ 8 % des hommes distinguent mal le
 * rouge du vert, exactement les deux teintes qui portent ici l'information la
 * plus importante. Le libellé textuel accompagne donc toujours la pastille, et
 * `label` alimente `aria-label` pour les lecteurs d'écran.
 */
export const AccompagneeDuTexte: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-sm">
      <span className="flex items-center gap-2">
        <StatusDot tone="success" label="En ligne" /> En ligne
      </span>
      <span className="flex items-center gap-2">
        <StatusDot tone="danger" label="Hors ligne" /> Hors ligne
      </span>
    </div>
  ),
};
