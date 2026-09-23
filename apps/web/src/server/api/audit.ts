import { AuditFilters } from "@gamedashboard/contracts";
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

/**
 * Les filtres que l'API comprend, tirés du schéma qu'elle applique.
 *
 * La page les relaie tous : l'export reprend l'adresse entière, et une liste
 * qui en ignorerait un montrerait autre chose que le fichier. Lus dans le
 * schéma plutôt que recopiés, un filtre ajouté à l'API arrive ici sans qu'on y
 * pense.
 */
export const AUDIT_FILTER_KEYS = AuditFilters.keyof().options;

export async function fetchAudit(
  params: Partial<Record<(typeof AUDIT_FILTER_KEYS)[number], string>> & { page?: number },
): Promise<AuditPage> {
  const search = new URLSearchParams();
  for (const key of AUDIT_FILTER_KEYS) {
    const value = params[key];
    if (value) search.set(key, value);
  }
  if (params.page && params.page > 1) search.set("page", String(params.page));

  const suffix = search.toString();
  const { data, meta } = await apiFetch<{
    data: AuditEntry[];
    meta: { page: number; hasMore: boolean };
  }>(`/api/v1/admin/activity${suffix ? `?${suffix}` : ""}`);

  return { items: data, page: meta.page, hasMore: meta.hasMore };
}
