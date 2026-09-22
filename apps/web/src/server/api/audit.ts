import { apiFetch } from "./client";

/**
 * Une ligne du journal de la plateforme.
 *
 * `serverId` nul désigne un événement de compte — mot de passe changé, adresse
 * confirmée, rôle modifié. Ce sont précisément les lignes qu'aucun écran ne
 * montrait, puisqu'elles n'appartiennent à aucun serveur.
 */
export interface AuditEntry {
  id: string;
  event: string;
  actorId: string | null;
  actorLabel: string;
  actorType: "user" | "api_key" | "system";
  ip: string | null;
  properties: Record<string, unknown>;
  at: string;
  serverId: string | null;
  serverName: string | null;
}

export interface AuditPage {
  items: AuditEntry[];
  page: number;
  hasMore: boolean;
}

export async function fetchAudit(params: {
  query?: string;
  event?: string;
  page?: number;
}): Promise<AuditPage> {
  const search = new URLSearchParams();
  if (params.query) search.set("query", params.query);
  if (params.event) search.set("event", params.event);
  if (params.page && params.page > 1) search.set("page", String(params.page));

  const suffix = search.toString();
  const { data, meta } = await apiFetch<{
    data: AuditEntry[];
    meta: { page: number; hasMore: boolean };
  }>(`/api/v1/admin/activity${suffix ? `?${suffix}` : ""}`);

  return { items: data, page: meta.page, hasMore: meta.hasMore };
}
