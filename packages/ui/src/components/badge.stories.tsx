import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge, type BadgeProps } from "./badge";
import { StatusDot } from "./status-dot";

type Variant = NonNullable<BadgeProps["variant"]>;

/** Exhaustive : ajouter une variante sans l'illustrer fait échouer le typage. */
const VARIANTS = {
  neutral: true,
  accent: true,
  solid: true,
  success: true,
  warning: true,
  danger: true,
  info: true,
  outline: true,
} satisfies Record<Variant, true>;

const meta = {
  title: "Atomes/Badge",
  component: Badge,
  args: { children: "Étiquette" },
  argTypes: {
    variant: { control: "select", options: Object.keys(VARIANTS) },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutre: Story = {};

export const Variantes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {(Object.keys(VARIANTS) as Variant[]).map((variant) => (
        <Badge key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  ),
};

/** Usage courant : l'état d'un serveur, pastille et texte ensemble. */
export const EtatServeur: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="success">
        <StatusDot tone="success" label="En ligne" /> En ligne
      </Badge>
      <Badge variant="warning">
        <StatusDot tone="warning" pulse label="Démarrage" /> Démarrage
      </Badge>
      <Badge variant="danger">
        <StatusDot tone="danger" label="Hors ligne" /> Hors ligne
      </Badge>
      <Badge variant="info">
        <StatusDot tone="info" pulse label="Installation" /> Installation
      </Badge>
    </div>
  ),
};
