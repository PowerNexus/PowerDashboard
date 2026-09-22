import type { Meta, StoryObj } from "@storybook/react-vite";
import { PowerControls } from "./power-controls";
import { SERVER_STATE_META, type ServerCardState } from "./server-card";

const meta = {
  title: "Molécules/PowerControls",
  component: PowerControls,
  args: { state: "offline" as ServerCardState, onSignal: () => undefined },
} satisfies Meta<typeof PowerControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HorsLigne: Story = {};

export const EnMarche: Story = { args: { state: "running" } };

/**
 * **Ce que ces boutons ferment est plus important que ce qu'ils ouvrent.**
 *
 * Chaque état ne permet pas les mêmes ordres : démarrer un serveur qui tourne
 * n'a pas de sens, l'arrêter quand il est déjà hors ligne non plus. Un bouton
 * actif qui sera refusé par l'API apprend la règle par l'échec — après le clic,
 * et souvent après une attente.
 *
 * Cette histoire montre les quatre boutons pour **chaque** état, côte à côte :
 * c'est le seul endroit où l'on voit la règle entière d'un coup d'œil.
 */
export const TousLesEtats: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(Object.keys(SERVER_STATE_META) as ServerCardState[]).map((state) => (
        <div key={state} className="flex items-center gap-4">
          <span className="w-32 shrink-0 text-muted text-sm">{state}</span>
          <PowerControls state={state} onSignal={() => undefined} />
        </div>
      ))}
    </div>
  ),
};

/**
 * `blocked` l'emporte sur l'état.
 *
 * Pendant une installation, une restauration ou un transfert, le daemon écrit
 * dans le volume : aucun des quatre ordres n'a de sens, quel que soit ce que
 * rapporte le conteneur. C'est l'état de **gestion** qui commande ici, pas
 * celui du conteneur — le daemon, lui, rapporte « hors ligne », ce qui est
 * exact de son point de vue et trompeur du nôtre.
 */
export const Bloque: Story = {
  args: { state: "offline", blocked: true },
};

export const Desactive: Story = {
  // `disabled` dit « vous n'avez pas le droit » ; `blocked` dit « pas
  // maintenant ». Les deux grisent, et les deux ne se disent pas pareil.
  args: { state: "running", disabled: true },
};
