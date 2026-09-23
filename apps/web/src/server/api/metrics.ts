"use server";

import type { MetricsHistory, MetricsRange } from "@gamedashboard/contracts";
import { apiReadFor } from "./client";

/**
 * Historique des mesures d'un serveur, sur une plage.
 *
 * Une action serveur et non une lecture de page : la plage change au clic, et
 * la console ne doit pas attendre trente jours d'agrégats pour s'afficher. Le
 * graphe arrive après, sans retarder ce qui est en direct.
 *
 * Le refus est **rendu**, pas levé : l'écran l'affiche dans le bloc, et le
 * reste de la console continue de fonctionner.
 */
export async function loadMetricsHistory(
  serverId: string,
  range: MetricsRange,
): Promise<{ error: string | null; history: MetricsHistory | null }> {
  try {
    const { data } = await apiReadFor<{ data: MetricsHistory }>(
      `/api/v1/client/servers/${encodeURIComponent(serverId)}/metrics?range=${encodeURIComponent(range)}`,
    );
    return { error: null, history: data };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Lecture refusée.", history: null };
  }
}
