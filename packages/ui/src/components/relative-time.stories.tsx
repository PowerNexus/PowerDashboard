import type { Meta, StoryObj } from "@storybook/react-vite";
import { RelativeTime } from "./relative-time";

const meta = {
  title: "Atomes/RelativeTime",
  component: RelativeTime,
  args: { value: new Date(Date.now() - 51 * 60_000).toISOString() },
} satisfies Meta<typeof RelativeTime>;

export default meta;
type Story = StoryObj<typeof meta>;

export const IlYA: Story = {};

/**
 * L'échelle complète, de la seconde à l'année.
 *
 * Le temps relatif se lit d'un coup d'œil — « il y a 51 minutes » se comprend
 * sans calcul, contrairement à un horodatage. Le revers est qu'il perd la
 * précision : c'est pourquoi le composant garde la date exacte dans son
 * attribut de survol, pour qui a besoin de la minute près.
 */
export const Echelle: Story = {
  render: () => {
    const maintenant = Date.now();
    const instants: [string, number][] = [
      ["à l'instant", 5_000],
      ["minutes", 8 * 60_000],
      ["une heure", 62 * 60_000],
      ["heures", 5 * 3_600_000],
      ["hier", 26 * 3_600_000],
      ["jours", 4 * 86_400_000],
      ["semaines", 18 * 86_400_000],
      ["mois", 120 * 86_400_000],
      ["années", 800 * 86_400_000],
    ];

    return (
      <table className="text-sm">
        <tbody>
          {instants.map(([nom, delta]) => (
            <tr key={nom}>
              <td className="py-1 pr-6 text-muted">{nom}</td>
              <td className="py-1 text-fg">
                <RelativeTime value={new Date(maintenant - delta).toISOString()} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
};

/**
 * L'absence de date, dite plutôt que laissée vide.
 *
 * « Jamais connecté » et « on ne sait pas » se ressemblent à l'écran mais pas
 * dans la tête de celui qui lit. Un tiret cadratin dit « rien ici », là où une
 * case vide se lit comme un défaut d'affichage.
 */
export const Absente: Story = {
  render: () => (
    <div className="flex gap-6 text-sm">
      <RelativeTime value={null} />
      <RelativeTime value={null} fallback="Jamais" />
      <RelativeTime value="pas-une-date" fallback="Date illisible" />
    </div>
  ),
};
