"use server";

import type { EngineOption, InstalledEngine } from "@gamedashboard/contracts";
import { revalidatePath } from "next/cache";
import { apiFetch, apiSend } from "./client";

export interface EngineRuntime {
  game: string;
  loader: string;
  gameVersion: string;
  directory: string;
}

export interface EngineState {
  /** Plateformes de serveur compatibles : Paper, Purpur, Fabric, Vanilla… */
  platforms: EngineOption[];
  /** Modpacks, quand le chargeur du serveur en accepte. */
  packs: EngineOption[];
  runtime: EngineRuntime | null;
  /** `null` quand le moteur du serveur n'a pas pu être déterminé. */
  unavailableReason: string | null;
  current: InstalledEngine | null;
}

export async function fetchEngineState(serverId: string, query: string): Promise<EngineState> {
  const params = query.trim() === "" ? "" : `?q=${encodeURIComponent(query.trim())}`;
  const { data, meta } = await apiFetch<{
    data: { platforms: EngineOption[]; packs: EngineOption[] };
    meta: {
      runtime: EngineRuntime | null;
      unavailableReason: string | null;
      current: InstalledEngine | null;
    };
  }>(`/api/v1/client/servers/${serverId}/engine${params}`);

  return { ...data, ...meta };
}

/**
 * Remplace le moteur du serveur.
 *
 * Ni l'adresse ni le nom de fichier ne partent d'ici : seul le couple
 * « quel moteur, quelle version » est transmis, et l'API résout le reste. Une
 * URL venue du navigateur ferait du daemon un téléchargeur de fichiers
 * arbitraires.
 */
export async function installEngine(
  serverId: string,
  optionId: string,
  versionId: string,
): Promise<{ error: string | null }> {
  try {
    await apiSend(`/api/v1/client/servers/${serverId}/engine/install`, { optionId, versionId });
    revalidatePath(`/server/${serverId}/engine`);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Opération refusée." };
  }
}

/** L'état du contrat de licence Minecraft pour ce serveur. */
export interface EulaState {
  /** Faux hors Minecraft : le fichier n'y aurait aucun sens. */
  applicable: boolean;
  /** `null` quand le fichier est illisible ; faux quand il n'existe pas encore. */
  accepted: boolean | null;
  url: string;
}

export async function fetchEulaState(serverId: string): Promise<EulaState> {
  const { data } = await apiFetch<{ data: EulaState }>(`/api/v1/client/servers/${serverId}/eula`);
  return data;
}

/**
 * Accepte le contrat de licence, explicitement.
 *
 * Le panel ne l'accepte jamais de lui-même : écrire ce fichier, c'est accepter
 * un contrat au nom de quelqu'un. Qui a cliqué et quand vont au journal
 * d'activité — le fichier, lui, vit dans le conteneur et se réécrit.
 */
export async function acceptEula(serverId: string): Promise<{ error: string | null }> {
  try {
    await apiSend(`/api/v1/client/servers/${serverId}/eula`, {});
    revalidatePath(`/server/${serverId}/engine`);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Opération refusée." };
  }
}
