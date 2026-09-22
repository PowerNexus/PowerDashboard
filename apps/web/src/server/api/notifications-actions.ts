"use server";

import { revalidatePath } from "next/cache";
import { apiSend } from "./client";

/**
 * Marque toutes les notifications comme lues.
 *
 * `revalidatePath("/", "layout")` : la cloche vit dans la coquille, présente
 * sur toutes les pages. Ne rafraîchir que la page courante laisserait le
 * compteur inchangé partout ailleurs.
 */
export async function markNotificationsRead(): Promise<void> {
  try {
    await apiSend("/api/v1/client/notifications/read-all", {});
    revalidatePath("/", "layout");
  } catch {
    // L'échec ne mérite pas d'écran d'erreur : la cloche se recalcule au
    // prochain chargement, et l'action n'a rien détruit.
  }
}
