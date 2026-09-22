import type { Meta, StoryObj } from "@storybook/react-vite";
import { Cpu, HardDrive, MemoryStick, Server } from "lucide-react";
import { MetricBar, StatTile } from "./stat-tile";

const meta = {
  title: "Molécules/StatTile",
  component: StatTile,
  args: { label: "Serveurs actifs", value: "12", icon: <Server /> },
} satisfies Meta<typeof StatTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Defaut: Story = {};

export const AvecIndication: Story = {
  args: { hint: "+2 cette semaine", tone: "success" },
};

export const Tonalites: Story = {
  render: (args) => (
    <div className="grid gap-3 sm:grid-cols-2">
      {(["default", "accent", "success", "warning", "danger"] as const).map((tone) => (
        <StatTile key={tone} {...args} tone={tone} label={tone} />
      ))}
    </div>
  ),
};

type BarStory = StoryObj<typeof MetricBar>;

const gb = (v: number) => `${(v / 1024).toFixed(1)} Go`;

export const Ressources: BarStory = {
  render: () => (
    <div className="flex max-w-md flex-col gap-5">
      <MetricBar label="Processeur" value={34} max={100} format={(v) => `${v} %`} />
      <MetricBar label="Mémoire" value={2150} max={4096} format={gb} />
      <MetricBar label="Disque" value={9800} max={10240} format={gb} />
    </div>
  ),
};

/**
 * Le cas qui justifie l'existence du composant.
 *
 * Quand le node est injoignable, sa consommation est **inconnue** — pas nulle.
 * Afficher une barre vide à zéro serait une affirmation fausse, et la plus
 * trompeuse possible : « tout va bien, rien ne consomme ». Les hachures disent
 * que la capacité est connue mais pas l'occupation.
 */
export const MesureInconnue: BarStory = {
  render: () => (
    <div className="flex max-w-md flex-col gap-5">
      <MetricBar label="Processeur" value={null} max={100} format={(v) => `${v} %`} />
      <MetricBar label="Mémoire" value={null} max={4096} format={gb} />
      <MetricBar
        label="Disque"
        value={null}
        max={10240}
        format={gb}
        unknownLabel="Daemon injoignable"
      />
    </div>
  ),
};

export const Comparaison: BarStory = {
  render: () => (
    <div className="grid max-w-3xl gap-8 sm:grid-cols-2">
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-muted">Mesure disponible</p>
        <MetricBar label="Mémoire" value={0} max={4096} format={gb} />
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-muted">Mesure inconnue</p>
        <MetricBar label="Mémoire" value={null} max={4096} format={gb} />
      </div>
    </div>
  ),
};

export const TableauDeBord: Story = {
  render: () => (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile label="Serveurs" value="12" icon={<Server />} tone="accent" />
      <StatTile label="Processeur" value="34 %" icon={<Cpu />} hint="moyenne 5 min" />
      <StatTile label="Mémoire" value="2,1 Go" icon={<MemoryStick />} />
      <StatTile label="Disque" value="96 %" icon={<HardDrive />} tone="danger" hint="quasi plein" />
    </div>
  ),
};
