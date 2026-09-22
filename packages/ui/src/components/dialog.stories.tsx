import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "./button";
import { ConfirmDialog, Dialog, DialogContent } from "./dialog";
import { FormField, Input } from "./input";

const meta = {
  title: "Organismes/Dialog",
  component: DialogContent,
  args: { title: "Nouvelle base de données" },
} satisfies Meta<typeof DialogContent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Formulaire: Story = {
  render: function Formulaire() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Ouvrir</Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent
            title="Nouvelle base de données"
            description="Elle sera créée sur l'hôte MySQL de la machine."
            footer={<Button onClick={() => setOpen(false)}>Créer</Button>}
          >
            <FormField label="Nom" description="Préfixé par l'identifiant du serveur.">
              {(id) => <Input id={id} placeholder="boutique" />}
            </FormField>
          </DialogContent>
        </Dialog>
      </>
    );
  },
};

/**
 * La confirmation ordinaire : un geste réversible.
 *
 * Elle existe pour éviter le clic distrait, pas pour dissuader. Le bouton
 * d'action garde donc son apparence normale — le teindre en rouge pour tout
 * banaliserait le rouge des gestes qui, eux, ne se rattrapent pas.
 */
export const Confirmation: Story = {
  render: function Confirmation() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Redémarrer
        </Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Redémarrer ce serveur ?"
          description="Les joueurs connectés seront déconnectés le temps du redémarrage."
          confirmLabel="Redémarrer"
          onConfirm={() => setOpen(false)}
        />
      </>
    );
  },
};

/**
 * **La saisie obligatoire, pour ce qui ne se rattrape pas.**
 *
 * Un bouton rouge ne protège de rien : on clique par habitude. Recopier le nom
 * de ce qu'on détruit oblige à le lire, donc à vérifier qu'on a bien désigné
 * ce qu'on croit. C'est le seul garde-fou qui résiste à la distraction, et il
 * est réservé aux suppressions définitives — l'employer partout le rendrait
 * mécanique, donc inutile.
 */
export const SuppressionDefinitive: Story = {
  render: function Suppression() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Supprimer le serveur
        </Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="Supprimer « Survie 1.20 » ?"
          description="Le serveur, son volume et ses sauvegardes locales sont détruits. Cette opération ne s'annule pas."
          confirmLabel="Supprimer définitivement"
          destructive
          requireTyped="Survie 1.20"
          onConfirm={() => setOpen(false)}
        />
      </>
    );
  },
};
