import { apiFetch } from "./client";

/**
 * Lecture des notifications.
 *
 * Sans `"use server"`, contrairement à `notifications-actions.ts` : cette
 * directive impose que **tout** export du module soit une fonction asynchrone,
 * ce qui exclut le type ci-dessous. Même découpage que pour l'administration —
 * les types et les lectures d'un côté, les actions de l'autre.
 */
export interface Notification {
  id: string;
  title: string;
  body: string;
  level: "info" | "success" | "warning" | "danger";
  /** Nom du serveur concerné, ou `null` quand la notification n'en vise aucun. */
  source: string | null;
  /** Où mène la notification, ou `null` quand il n'y a rien à ouvrir. */
  href: string | null;
  createdAt: string;
  readAt: string | null;
}

export async function fetchNotifications(): Promise<Notification[]> {
  const { data } = await apiFetch<{ data: Notification[] }>("/api/v1/client/notifications");
  return data;
}
