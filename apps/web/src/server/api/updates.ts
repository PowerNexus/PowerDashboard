"use server";

import type { UpdateStatus } from "@gamedashboard/contracts";
import { revalidatePath } from "next/cache";
import { apiReadFor, apiSendFor } from "./client";

/**
 * Mise à jour autonome (hébergement cPanel), vue de l'administration.
 *
 * Une lecture d'appoint : la carte n'est qu'un bloc de la vue d'ensemble, et
 * une API qui ne la connaît pas — ou qui la refuse — ne doit rien casser
 * autour. Elle ne s'affiche alors simplement pas.
 */
export const fetchUpdateStatus = async (): Promise<UpdateStatus> => {
  try {
    const { data } = await apiReadFor<{ data: UpdateStatus }>("/api/v1/admin/updates");
    return data;
  } catch {
    return { actif: false };
  }
};

export async function checkForUpdate(): Promise<{ error: string | null }> {
  return act("/api/v1/admin/updates/check");
}

export async function rollbackUpdate(): Promise<{ error: string | null }> {
  return act("/api/v1/admin/updates/rollback");
}

async function act(path: string): Promise<{ error: string | null }> {
  try {
    await apiSendFor<{ data: UpdateStatus }>(path, {});
    revalidatePath("/admin");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Opération refusée." };
  }
}
