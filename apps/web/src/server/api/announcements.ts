"use server";

import { revalidatePath } from "next/cache";
import { apiFetch, apiSend } from "./client";

export interface Announcement {
  id: string;
  title: string;
  bodyMd: string;
  level: "info" | "warning" | "critical";
  startsAt: string;
  endsAt: string | null;
  /** Rôles visés. Vide = tout le monde, ce qui est le cas courant. */
  audience: string[];
}

/**
 * Annonces en cours pour le compte connecté.
 *
 * L'échec est avalé et rend une liste vide : une annonce est un supplément
 * d'information, et faire échouer le rendu de tout le panel parce qu'on n'a
 * pas pu la lire serait hors de proportion.
 */
export const fetchActiveAnnouncements = async (): Promise<Announcement[]> => {
  try {
    const { data } = await apiFetch<{ data: Announcement[] }>(
      "/api/v1/client/notifications/announcements",
    );
    return data;
  } catch {
    return [];
  }
};

export const fetchAnnouncements = async (): Promise<Announcement[]> => {
  const { data } = await apiFetch<{ data: Announcement[] }>("/api/v1/admin/announcements");
  return data;
};

export async function saveAnnouncement(
  input: Partial<Announcement>,
): Promise<{ error: string | null }> {
  return act(() => apiSend("/api/v1/admin/announcements", input));
}

export async function deleteAnnouncement(id: string): Promise<{ error: string | null }> {
  return act(() => apiSend(`/api/v1/admin/announcements/${id}`, undefined, "DELETE"));
}

async function act(call: () => Promise<void>): Promise<{ error: string | null }> {
  try {
    await call();
    // La coquille de **toutes** les pages affiche les annonces en cours : c'est
    // le chemin entier qui est périmé, pas l'écran d'administration seul.
    revalidatePath("/", "layout");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Opération refusée." };
  }
}
