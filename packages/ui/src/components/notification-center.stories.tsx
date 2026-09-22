import type { Meta, StoryObj } from "@storybook/react-vite";
import { NotificationCenter, type NotificationItem } from "./notification-center";

function ilYA(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const NOTIFICATIONS: NotificationItem[] = [
  {
    id: "1",
    title: "La tâche « Sauvegarde nocturne » a échoué",
    body: "Sur « Survie 1.20 » : quota de sauvegardes atteint. Supprimez-en une pour que la suivante passe.",
    level: "warning",
    createdAt: ilYA(12),
    readAt: null,
    source: "Planificateur",
  },
  {
    id: "2",
    title: "Machine fr-01 injoignable",
    body: "Le daemon n'a pas répondu depuis huit minutes.",
    level: "danger",
    createdAt: ilYA(35),
    readAt: null,
    source: "Supervision",
  },
  {
    id: "3",
    title: "Sauvegarde terminée",
    body: "« Créatif » — 1,4 Go.",
    level: "success",
    createdAt: ilYA(180),
    readAt: ilYA(170),
  },
  {
    id: "4",
    title: "Votre serveur a changé de machine",
    body: "« Modded » a été déplacé sur de-01. Son adresse a changé.",
    level: "info",
    createdAt: ilYA(1_500),
    readAt: ilYA(1_400),
  },
];

const meta = {
  title: "Organismes/NotificationCenter",
  component: NotificationCenter,
  args: { notifications: NOTIFICATIONS, onMarkAllRead: () => undefined },
} satisfies Meta<typeof NotificationCenter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AvecNonLues: Story = {};

export const ToutesLues: Story = {
  args: { notifications: NOTIFICATIONS.map((n) => ({ ...n, readAt: ilYA(1) })) },
};

/**
 * Vide, et c'est une bonne nouvelle.
 *
 * L'état vide d'un centre de notifications ne doit pas ressembler à un échec
 * de chargement : rien à signaler est le fonctionnement normal, et la plupart
 * du temps c'est ce qu'on veut lire.
 */
export const Vide: Story = {
  args: { notifications: [] },
};

/**
 * Le volume d'un incident.
 *
 * Quand un node tombe, chaque serveur qu'il portait produit sa ligne. C'est le
 * moment où la liste doit rester parcourable — et où le bouton « tout marquer
 * comme lu » cesse d'être un ornement.
 */
export const Beaucoup: Story = {
  args: {
    notifications: Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      title: `Serveur « srv-${i} » arrêté`,
      body: "La machine qui l'hébergeait ne répond plus.",
      level: "danger" as const,
      createdAt: ilYA(i * 2),
      readAt: null,
      source: "Supervision",
    })),
  },
};
