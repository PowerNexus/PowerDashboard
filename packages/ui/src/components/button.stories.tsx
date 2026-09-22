import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus, Trash2 } from "lucide-react";
import { Button, type ButtonProps } from "./button";

type Variant = NonNullable<ButtonProps["variant"]>;
type Size = NonNullable<ButtonProps["size"]>;

/**
 * Listes exhaustives, garanties par `satisfies Record<…>`.
 *
 * `cva` n'expose pas ses variantes au niveau des types, mais les énumérer à la
 * main vaut mieux qu'une introspection : le typage échoue ici dès qu'une
 * variante est **ajoutée** au composant sans être documentée. Une lecture du
 * runtime, elle, aurait affiché la nouvelle variante sans que personne n'ait à
 * lui donner un exemple d'usage.
 */
const VARIANTS = {
  primary: true,
  secondary: true,
  ghost: true,
  soft: true,
  danger: true,
  "danger-ghost": true,
  outline: true,
  link: true,
} satisfies Record<Variant, true>;

const SIZES = {
  sm: true,
  md: true,
  lg: true,
  icon: true,
  "icon-sm": true,
} satisfies Record<Size, true>;

const meta = {
  title: "Atomes/Button",
  component: Button,
  args: { children: "Enregistrer" },
  argTypes: {
    variant: { control: "select", options: Object.keys(VARIANTS) },
    size: { control: "select", options: Object.keys(SIZES) },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primaire: Story = {};

/**
 * Toutes les variantes côte à côte. C'est la vue qui sert vraiment : choisir
 * une variante suppose de voir les autres.
 */
export const Variantes: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      {(Object.keys(VARIANTS) as Variant[]).map((variant) => (
        <Button key={variant} {...args} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
};

export const Tailles: Story = {
  render: (args) => (
    <div className="flex flex-wrap items-center gap-3">
      <Button {...args} size="sm">
        Petit
      </Button>
      <Button {...args} size="md">
        Moyen
      </Button>
      <Button {...args} size="lg">
        Grand
      </Button>
      <Button {...args} size="icon" aria-label="Ajouter">
        <Plus />
      </Button>
    </div>
  ),
};

export const AvecIcone: Story = {
  args: {
    children: (
      <>
        <Plus /> Nouveau serveur
      </>
    ),
  },
};

/**
 * Pendant le chargement, le bouton reste focalisable et annonce son état au
 * lecteur d'écran : `aria-disabled` plutôt que `disabled`, qui retirerait
 * l'élément de l'ordre de tabulation sans prévenir personne.
 */
export const Chargement: Story = {
  args: { loading: true, children: "Création en cours" },
};

export const Desactive: Story = {
  args: { disabled: true },
};

export const Destructeur: Story = {
  args: {
    variant: "danger",
    children: (
      <>
        <Trash2 /> Supprimer le serveur
      </>
    ),
  },
};

/**
 * `asChild` fait porter le style par l'élément enfant. Utile pour un lien qui
 * doit ressembler à un bouton sans cesser d'être un lien — donc ouvrable dans
 * un nouvel onglet, ce qu'un `<button>` avec un `onClick` ne permet pas.
 */
export const CommeLien: Story = {
  args: {
    asChild: true,
    children: <a href="https://gamedashboard.fr">Ouvrir le site</a>,
  },
};
