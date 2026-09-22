import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SettingToggle, Switch } from "./switch";

const meta = {
  title: "Atomes/Switch",
  component: Switch,
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Etats: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <Switch checked={false} aria-label="Éteint" />
      <Switch checked aria-label="Allumé" />
      <Switch checked={false} disabled aria-label="Éteint et verrouillé" />
      <Switch checked disabled aria-label="Allumé et verrouillé" />
    </div>
  ),
};

/**
 * Un interrupteur nu n'a pas de nom pour qui ne voit pas l'écran.
 *
 * `SettingToggle` lui en donne un, et lui adjoint la phrase qui dit **ce que
 * l'interrupteur engage**. C'est la forme employée partout dans les réglages :
 * un interrupteur dont on ne sait pas ce qu'il coupe se laisse rarement
 * toucher.
 */
export const Reglage: Story = {
  render: function Reglage() {
    const [oom, setOom] = useState(true);
    const [maintenance, setMaintenance] = useState(false);

    return (
      <div className="flex max-w-xl flex-col gap-5">
        <SettingToggle
          label="Tueur de mémoire"
          description="Arrête le conteneur quand il dépasse sa limite. Le désactiver laisse un serveur consommer au-delà, au détriment de ses voisins de machine."
          checked={oom}
          onCheckedChange={setOom}
        />
        <SettingToggle
          label="Mode maintenance"
          description="La machine cesse d'accepter de nouveaux serveurs. Ceux qui y tournent continuent."
          checked={maintenance}
          onCheckedChange={setMaintenance}
        />
        <SettingToggle
          label="Réglage verrouillé"
          description="Décidé par la plateforme : l'hébergeur en répond, pas le client."
          checked
          disabled
          onCheckedChange={() => undefined}
        />
      </div>
    );
  },
};
