"use server";

import { apiFetch } from "./client";

export interface ActivityEntry {
  id: string;
  event: string;
  actorLabel: string;
  actorType: "user" | "api_key" | "system";
  ip: string | null;
  properties: Record<string, unknown>;
  at: string;
}

export interface ActivityPage {
  items: ActivityEntry[];
  page: number;
  hasMore: boolean;
}

/**
 * Journal d'un serveur.
 *
 * La recherche et la pagination passent par l'API, jamais par un filtre en
 * mémoire : le journal grossit sans fin, et filtrer une page déjà tronquée
 * répondrait « aucun résultat » pour un événement qui existe.
 */
export async function fetchActivity(
  serverId: string,
  options: { query?: string; page?: number } = {},
): Promise<ActivityPage> {
  const params = new URLSearchParams();
  if (options.query) params.set("q", options.query);
  if (options.page && options.page > 1) params.set("page", String(options.page));
  const suffix = params.size > 0 ? `?${params}` : "";

  const { data, meta } = await apiFetch<{
    data: ActivityEntry[];
    meta: { page: number; hasMore: boolean };
  }>(`/api/v1/client/servers/${serverId}/activity${suffix}`);

  return { items: data, ...meta };
}
