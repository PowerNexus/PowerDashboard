import type { Meta, StoryObj } from "@storybook/react-vite";
import { SearchX } from "lucide-react";
import { Badge } from "./badge";
import { type ColumnDef, DataTable } from "./data-table";
import { EmptyState } from "./empty-state";

interface Serveur {
  id: string;
  nom: string;
  etat: "running" | "offline" | "suspended";
  machine: string;
}

const LIGNES: Serveur[] = [
  { id: "31201e0c", nom: "Survie 1.20", etat: "running", machine: "fr-01" },
  { id: "8a7f2b11", nom: "Créatif", etat: "offline", machine: "fr-01" },
  { id: "c4d9e033", nom: "Modded", etat: "suspended", machine: "de-01" },
];

const COLONNES: ColumnDef<Serveur>[] = [
  {
    accessorKey: "nom",
    header: "Serveur",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium text-fg">{row.original.nom}</span>
        <span className="gd-mono text-faint text-xs">{row.original.id}</span>
      </div>
    ),
  },
  {
    accessorKey: "etat",
    header: "État",
    cell: ({ getValue }) => {
      const etat = getValue() as Serveur["etat"];
      const variante =
        etat === "running" ? "success" : etat === "suspended" ? "warning" : "neutral";
      return <Badge variant={variante}>{etat}</Badge>;
    },
  },
  { accessorKey: "machine", header: "Machine" },
];

const meta = {
  title: "Organismes/DataTable",
  component: DataTable<Serveur>,
  args: { columns: COLONNES, data: LIGNES },
} satisfies Meta<typeof DataTable<Serveur>>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Rempli: Story = {};

/**
 * Le chargement, à la forme du tableau.
 *
 * Les squelettes ont le nombre de colonnes réel : la page ne saute pas quand
 * les données arrivent, et c'est ce saut qui fait cliquer sur la mauvaise
 * ligne.
 */
export const Chargement: Story = {
  args: { data: undefined, isLoading: true },
};

/**
 * **Vide et vide ne sont pas la même chose.**
 *
 * « Aucun serveur » invite à en créer un. « Aucun résultat » invite à changer
 * la recherche. Le tableau ne peut pas deviner lequel des deux : c'est
 * l'appelant qui fournit l'état vide, parce que lui seul sait s'il filtre.
 */
export const Vide: Story = {
  args: {
    data: [],
    emptyState: (
      <EmptyState
        icon={<SearchX />}
        title="Aucun résultat"
        description="Aucun serveur ne correspond à « minecra »."
      />
    ),
  },
};

export const LignesCliquables: Story = {
  args: { onRowClick: () => undefined },
};
