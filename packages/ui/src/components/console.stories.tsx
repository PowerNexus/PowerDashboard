import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ConsoleLine, ConsoleView } from "./console";

const LIGNES: ConsoleLine[] = [
  { id: 1, source: "system", text: "Connexion au daemon…" },
  {
    id: 2,
    source: "server",
    text: "[12:04:01] [Server thread/INFO]: Starting minecraft server version 1.20.1",
  },
  { id: 3, source: "server", text: "[12:04:02] [Server thread/INFO]: Loading properties" },
  {
    id: 4,
    source: "server",
    text: '[12:04:09] [Server thread/INFO]: Done (7.412s)! For help, type "help"',
  },
  { id: 5, source: "system", label: "vous", text: "list" },
  {
    id: 6,
    source: "server",
    text: "[12:05:33] [Server thread/INFO]: There are 7 of a max of 40 players online",
  },
];

const meta = {
  title: "Organismes/Console",
  component: ConsoleView,
  args: {
    lines: LIGNES,
    onSend: () => undefined,
    commands: ["say <message>", "list", "whitelist add <joueur>", "stop"],
  },
} satisfies Meta<typeof ConsoleView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EnMarche: Story = {};

/**
 * La ligne de commande fermée.
 *
 * Pendant une installation, ce qu'on y taperait partirait à un programme qui
 * n'existe pas encore ; sur un serveur arrêté, à personne. Le champ est donc
 * désactivé plutôt que silencieusement ignoré — un champ qui accepte la frappe
 * et ne fait rien est la pire des trois formes.
 */
export const LectureSeule: Story = {
  args: { disabled: true },
};

/**
 * Vide, mais connectée.
 *
 * Un serveur qui vient de démarrer n'a encore rien dit. « En attente de
 * sortie… » distingue ce cas de la console qui n'a pas réussi à s'ouvrir —
 * deux situations qui se ressemblent à l'écran et n'appellent pas le même
 * geste.
 */
export const Vide: Story = {
  args: { lines: [] },
};

/**
 * Le volume réel d'un démarrage moddé.
 *
 * Deux cents lignes en quelques secondes : c'est là que se voient le défilement
 * automatique et le coût du rendu. Une console qui rame au démarrage est une
 * console qu'on ferme, donc qu'on ne lit plus quand il le faudrait.
 */
export const Volumineuse: Story = {
  args: {
    lines: Array.from({ length: 200 }, (_, i) => ({
      id: i,
      source: i % 17 === 0 ? ("system" as const) : ("server" as const),
      text:
        i % 17 === 0
          ? `[12:0${(i % 6) + 1}:00] Chargement du mod ${i}`
          : `[12:0${(i % 6) + 1}:00] [Server thread/INFO]: ligne de journal numéro ${i}`,
    })),
  },
};
