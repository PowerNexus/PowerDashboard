import type { Meta, StoryObj } from "@storybook/react-vite";
import { Mail, Search } from "lucide-react";
import { FormField, Input, PasswordInput } from "./input";

const meta = {
  title: "Atomes/Input",
  component: Input,
  args: { placeholder: "alex@exemple.fr" },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Simple: Story = {};

export const AvecIcone: Story = {
  args: { leadingIcon: <Mail /> },
};

export const Etats: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-4">
      <Input placeholder="Au repos" />
      <Input placeholder="Désactivé" disabled />
      <Input placeholder="Avec une valeur" defaultValue="31201e0c" />
      <Input placeholder="Recherche" leadingIcon={<Search />} />
    </div>
  ),
};

/**
 * Le champ de mot de passe et son bouton d'affichage.
 *
 * Le bouton porte un libellé accessible distinct — « Afficher le mot de
 * passe » — sans quoi un lecteur d'écran annoncerait « bouton » sans dire
 * lequel. C'est aussi ce qui le rend trouvable pour les tests.
 */
export const MotDePasse: Story = {
  render: () => (
    <div className="max-w-md">
      <PasswordInput placeholder="••••••••••" defaultValue="un-mot-de-passe" />
    </div>
  ),
};

/**
 * `FormField` lie l'étiquette au champ par un identifiant qu'il produit
 * lui-même. C'est ce qui évite le défaut le plus courant d'un formulaire :
 * une étiquette qui n'est reliée à rien, donc invisible pour qui n'emploie
 * pas la souris.
 */
export const AvecEtiquette: Story = {
  render: () => (
    <div className="flex max-w-md flex-col gap-5">
      <FormField label="Adresse e-mail" description="Celle qui recevra les avertissements.">
        {(id) => <Input id={id} type="email" placeholder="alex@exemple.fr" />}
      </FormField>
      <FormField label="Nom du serveur" error="Ce nom est déjà employé.">
        {(id) => <Input id={id} defaultValue="Survie" aria-invalid />}
      </FormField>
    </div>
  ),
};
