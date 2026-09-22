import type { Meta, StoryObj } from "@storybook/react-vite";
import { Files, Plus, Server } from "lucide-react";
import { Button } from "./button";
import { PageHeader } from "./page-header";

const meta = {
  title: "Molécules/PageHeader",
  component: PageHeader,
  args: { title: "Mes serveurs", subtitle: "Ceux auxquels vous avez accès." },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Simple: Story = {};

export const AvecIconeEtAction: Story = {
  args: {
    icon: <Server />,
    actions: (
      <Button size="sm">
        <Plus /> Nouveau serveur
      </Button>
    ),
  },
};

/**
 * Le fil d'Ariane, sur les écrans d'un serveur.
 *
 * Le dernier maillon n'est pas un lien : il désigne la page où l'on est déjà.
 * Le rendre cliquable ferait recharger la même page, ce qu'un lecteur d'écran
 * annoncerait pourtant comme un lien à suivre.
 */
export const FilDAriane: Story = {
  args: {
    icon: <Files />,
    title: "Fichiers",
    subtitle: "Parcourez et modifiez les fichiers de votre serveur.",
    breadcrumbs: [{ label: "Mes serveurs", href: "/servers" }, { label: "Survie 1.20" }],
  },
};

/**
 * Un titre long, qui arrive plus souvent qu'on ne croit.
 *
 * Les clients nomment leurs serveurs comme ils veulent. L'en-tête doit se
 * replier sans pousser les actions hors de l'écran — c'est la première chose
 * qui casse sur un téléphone.
 */
export const TitreLong: Story = {
  args: {
    icon: <Server />,
    title: "Serveur Minecraft Survie Moddé — Saison 4 — communauté francophone",
    subtitle: "Un sous-titre lui aussi bien plus long que ce qu'on imagine en dessinant l'écran.",
    actions: (
      <>
        <Button size="sm" variant="secondary">
          Paramètres
        </Button>
        <Button size="sm">Démarrer</Button>
      </>
    ),
  },
};
