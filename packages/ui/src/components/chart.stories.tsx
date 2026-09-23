import type { Meta, StoryObj } from "@storybook/react-vite";
import { type Point, SparkChart } from "./chart";

/** Une série régulière, déterministe : une histoire ne doit pas changer d'un rendu à l'autre. */
function serie(n: number, base: number, amplitude: number): Point[] {
  return Array.from({ length: n }, (_, t) => ({
    t,
    v: Math.max(0, base + amplitude * Math.sin(t / 6) + (t % 5) * 1.5),
  }));
}

/** La même série, trouée là où le serveur était arrêté. */
function trouee(points: Point[], trous: [number, number][]): Point[] {
  return points.map((p) => (trous.some(([de, a]) => p.t >= de && p.t < a) ? { ...p, v: null } : p));
}

const meta = {
  title: "Molécules/SparkChart",
  component: SparkChart,
  args: { title: "Processeur", data: serie(60, 40, 20), max: 100, unit: " %" },
} satisfies Meta<typeof SparkChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EnDirect: Story = {};

/**
 * L'historique : moyenne pleine, maximum en pointillés, et des trous.
 *
 * Les trous restent des trous. Une courbe qui les franchit, ou qui tombe à
 * zéro, raconte un serveur au repos là où personne ne mesurait rien.
 */
export const HistoriqueAvecTrous: Story = {
  args: {
    title: "Processeur — 24 h",
    ranges: [],
    data: trouee(serie(288, 35, 15), [
      [60, 110],
      [200, 204],
    ]),
    peak: trouee(serie(288, 55, 20), [
      [60, 110],
      [200, 204],
    ]),
  },
};

export const RienDeMesure: Story = {
  args: {
    title: "Mémoire — 1 h",
    ranges: [],
    data: Array.from({ length: 60 }, (_, t) => ({ t, v: null })),
  },
};
