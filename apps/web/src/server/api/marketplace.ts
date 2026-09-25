"use server";

import type { AddonState, MarketplaceProject, MarketplaceSource } from "@gamedashboard/contracts";
import { revalidatePath } from "next/cache";
import { apiFetch, apiSend } from "./client";

export interface CatalogueEntry {
  project: MarketplaceProject;
  state: AddonState;
  /** Versions proposables, de la plus récente à la plus ancienne. */
  choices: string[];
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

/** Une extension installée, avec la mise à jour relevée par la veille. */
export interface InstalledExtension {
  projectId: string;
  source: MarketplaceSource;
  name: string;
  version: string;
  latestVersion: string | null;
  installedAt: string;
  checkedAt: string | null;
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
  /** Ce qui est installé, que la recherche du moment le montre ou non. */
  installed: InstalledExtension[];
}

export async function fetchCatalogue(serverId: string, query: string): Promise<Catalogue> {
  const params = query.trim() === "" ? "" : `?q=${encodeURIComponent(query.trim())}`;
  const { data, meta } = await apiFetch<{
    data: CatalogueEntry[];
    meta: {
      runtime: DetectedRuntime | null;
      unavailableReason: string | null;
      sources: SourceOutcome[];
      installed?: InstalledExtension[];
    };
  }>(`/api/v1/client/servers/${serverId}/marketplace${params}`);

  return { entries: data, ...meta, installed: meta.installed ?? [] };
}

/** Sans `version`, la plus récente compatible ; avec, exactement celle-là. */
export async function installAddon(
  serverId: string,
  projectId: string,
  version?: string,
): Promise<{ error: string | null }> {
  return act(serverId, () =>
    apiSend(
      `/api/v1/client/servers/${serverId}/marketplace/install`,
      version === undefined ? { projectId } : { projectId, version },
    ),
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

/**
 * Met à jour toutes les extensions en retard, l'une après l'autre.
 *
 * En série : chaque installation écrit dans le même dossier du conteneur, et
 * la première erreur arrête la suite plutôt que d'en empiler d'autres.
 */
export async function updateAllAddons(
  serverId: string,
  updates: { projectId: string; version: string }[],
): Promise<{ error: string | null }> {
  return act(serverId, async () => {
    for (const { projectId, version } of updates) {
      await apiSend(`/api/v1/client/servers/${serverId}/marketplace/install`, {
        projectId,
        version,
      });
    }
  });
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
