"use server";

import type { NodeBindingInput, NodeSettingsInput } from "@gamedashboard/contracts";
import { revalidatePath } from "next/cache";
import { apiFetch, apiSendFor } from "./client";

/**
 * Actions de la fiche d'un node, et du parcours « Ajouter une machine ».
 *
 * Fichier distinct d'`admin-actions.ts` : `"use server"` impose que tout export
 * soit une fonction asynchrone, et cet écran a ses propres formes de réponse —
 * la liaison, notamment, rend une issue à expliquer plutôt qu'une erreur.
 */

function failure(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function revalidateNode(nodeId: string) {
  revalidatePath("/admin/nodes");
  revalidatePath(`/admin/nodes/${nodeId}`);
}

export async function saveNodeSettings(
  nodeId: string,
  input: NodeSettingsInput,
): Promise<{ error: string | null }> {
  try {
    await apiSendFor(`/api/v1/admin/nodes/${nodeId}/settings`, input);
    revalidateNode(nodeId);
    return { error: null };
  } catch (error) {
    return { error: failure(error, "Réglages refusés.") };
  }
}

/** L'issue d'un changement d'adresse ou de ports, telle que l'API la rend. */
export interface BindingOutcome {
  status: "applied" | "unchanged" | "restart_required" | "refused";
  changed: string[];
  failure: string | null;
  /** Le `config.yml` à déposer à la main quand le daemon n'a pas été joint. */
  file: string | null;
}

export async function saveNodeBinding(
  nodeId: string,
  input: NodeBindingInput,
): Promise<{ error: string | null; outcome: BindingOutcome | null }> {
  try {
    const { data } = await apiSendFor<{ data: BindingOutcome }>(
      `/api/v1/admin/nodes/${nodeId}/binding`,
      input,
    );
    if (data.status === "applied") revalidateNode(nodeId);
    return { error: null, outcome: data };
  } catch (error) {
    return { error: failure(error, "Modification refusée."), outcome: null };
  }
}

export async function removeNodeAllocations(
  nodeId: string,
  ids: string[],
): Promise<{ error: string | null; removed: number }> {
  try {
    const { data } = await apiSendFor<{ data: { removed: number } }>(
      `/api/v1/admin/nodes/${nodeId}/allocations/remove`,
      { ids },
    );
    revalidateNode(nodeId);
    return { error: null, removed: data.removed };
  } catch (error) {
    return { error: failure(error, "Retrait refusé."), removed: 0 };
  }
}

/**
 * Dernier contact du daemon, pour l'étape « attendre le premier contact ».
 *
 * Une action serveur et non une lecture de page : le parcours la rappelle
 * toutes les quelques secondes sans recharger l'écran.
 */
export async function probeNodeContact(
  nodeId: string,
): Promise<{ lastHeartbeatAt: string | null; wingsVersion: string | null }> {
  try {
    const { data } = await apiFetch<{
      data: { lastHeartbeatAt: string | null; wingsVersion: string | null };
    }>(`/api/v1/admin/nodes/${nodeId}`);
    return { lastHeartbeatAt: data.lastHeartbeatAt, wingsVersion: data.wingsVersion };
  } catch {
    // Une lecture ratée n'est pas un échec du parcours : on redemandera.
    return { lastHeartbeatAt: null, wingsVersion: null };
  }
}
