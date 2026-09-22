import type { Meta, StoryObj } from "@storybook/react-vite";
import { Cpu, Globe, HardDrive } from "lucide-react";
import { SelectMenu } from "./select-menu";

const meta = {
  title: "Molécules/SelectMenu",
  component: SelectMenu,
  args: {
    "aria-label": "Machine",
    placeholder: "Choisir une machine",
    options: [
      { value: "fr-01", label: "fr-01 — Paris" },
      { value: "fr-02", label: "fr-02 — Paris" },
      { value: "de-01", label: "de-01 — Francfort" },
    ],
  },
} satisfies Meta<typeof SelectMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Simple: Story = {};

export const AvecDescriptionEtIcone: Story = {
  args: {
    options: [
      {
        value: "fr-01",
        label: "fr-01 — Paris",
        description: "12 serveurs · 64 Go · 32 cœurs",
        icon: <Globe />,
      },
      {
        value: "fr-02",
        label: "fr-02 — Paris",
        description: "3 serveurs · 32 Go · 16 cœurs",
        icon: <Cpu />,
      },
      {
        value: "de-01",
        label: "de-01 — Francfort",
        description: "En maintenance",
        icon: <HardDrive />,
        // Proposer sans dire ferait cliquer pour lire un refus.
        disabled: true,
      },
    ],
  },
};

/**
 * Le regroupement, employé pour le catalogue de jeux.
 *
 * Une liste plate de quarante eggs ne se parcourt pas. Groupés par nid, les
 * mêmes quarante entrées se lisent — et l'intitulé du groupe n'est pas
 * sélectionnable, ce qui évite de choisir « Minecraft » en croyant choisir un
 * jeu.
 */
export const Groupes: Story = {
  args: {
    "aria-label": "Jeu",
    placeholder: "Choisir un jeu",
    options: [
      { value: "paper", label: "Paper", group: "Minecraft" },
      { value: "forge", label: "Forge", group: "Minecraft" },
      { value: "fabric", label: "Fabric", group: "Minecraft" },
      { value: "rust", label: "Rust", group: "Survie" },
      { value: "valheim", label: "Valheim", group: "Survie" },
    ],
  },
};

export const Etats: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-4">
      <SelectMenu
        aria-label="Au repos"
        placeholder="Au repos"
        options={[{ value: "a", label: "Une option" }]}
      />
      <SelectMenu
        aria-label="Avec valeur"
        defaultValue="a"
        options={[{ value: "a", label: "Une option choisie" }]}
      />
      <SelectMenu
        aria-label="Désactivé"
        placeholder="Désactivé"
        disabled
        options={[{ value: "a", label: "Une option" }]}
      />
      <SelectMenu
        aria-label="En erreur"
        placeholder="Champ à corriger"
        invalid
        options={[{ value: "a", label: "Une option" }]}
      />
    </div>
  ),
};
