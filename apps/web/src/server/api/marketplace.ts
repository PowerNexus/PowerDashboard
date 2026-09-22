"use server";

import type { AddonState, MarketplaceProject, MarketplaceSource } from "@gamedashboard/contracts";
import { revalidatePath } from "next/cache";
import { apiFetch, apiSend } from "./client";

export interface CatalogueEntry {
  project: MarketplaceProject;
  state: AddonState;
}

export interface DetectedRuntime {
  game: string;
  loader: string;
  gameVersion: string;
  directory: string;
}

/** Une source interrogée et son sort. */
export interface SourceOutcome {
  source: MarketplaceSource;
  /** Message d'échec, ou `null` quand la source a répondu. */
  error: string | null;
  count: number;
}

export interface Catalogue {
  entries: CatalogueEntry[];
  /** `null` quand le chargeur du serveur n'a pas pu être déterminé. */
  runtime: DetectedRuntime | null;
  unavailableReason: string | null;
  /**
   * Le sort de chaque catalogue interrogé.
   *
   * Sans lui, une source tombée se lit comme un plugin qui n'existe pas :
   * même liste courte, aucune explication.
   */
  sources: SourceOutcome[];
}

export async function fetchCatalogue(serverId: string, query: string): Promise<Catalogue> {
  const params = query.trim() === "" ? "" : `?q=${encodeURIComponent(query.trim())}`;
  const { data, meta } = await apiFetch<{
    data: CatalogueEntry[];
    meta: {
      runtime: DetectedRuntime | null;
      unavailableReason: string | null;
      sources: SourceOutcome[];
    };
  }>(`/api/v1/client/servers/${serverId}/marketplace${params}`);

  return { entries: data, ...meta };
}

export async function installAddon(
  serverId: string,
  projectId: string,
): Promise<{ error: string | null }> {
  return act(serverId, () =>
    apiSend(`/api/v1/client/servers/${serverId}/marketplace/install`, { projectId }),
  );
}

export async function uninstallAddon(
  serverId: string,
  projectId: string,
): Promise<{ error: string | null }> {
  return act(serverId, () =>
    apiSend(`/api/v1/client/servers/${serverId}/marketplace/uninstall`, { projectId }),
  );
}

async function act(serverId: string, call: () => Promise<void>): Promise<{ error: string | null }> {
  try {
    await call();
    revalidatePath(`/server/${serverId}/marketplace`);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Opération refusée." };
  }
}
