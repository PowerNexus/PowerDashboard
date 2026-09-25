"use server";

import type {
  EngineInstallReport,
  EngineInstallRun,
  EngineOption,
  InstalledEngine,
} from "@gamedashboard/contracts";
import { revalidatePath } from "next/cache";
import { apiFetch, apiReadFor, apiSend, apiSendFor } from "./client";

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
  /** Ce que le panel a posé, `null` s'il n'a rien posé depuis la dernière réinstallation. */
  current: InstalledEngine | null;
  /** Le sort de chaque catalogue de modpacks : un CurseForge sans clé le dit. */
  packSources: { source: string; error: string | null }[];
  /** La dernière installation lancée : en cours, terminée ou échouée. */
  install: EngineInstallRun | null;
}

/** Ce qu'une installation a fait, pour le dire à l'écran. */
export type EngineInstallResult = EngineInstallReport;

export async function fetchEngineState(serverId: string, query: string): Promise<EngineState> {
  const params = query.trim() === "" ? "" : `?q=${encodeURIComponent(query.trim())}`;
  const { data, meta } = await apiFetch<{
    data: { platforms: EngineOption[]; packs: EngineOption[] };
    meta: {
      runtime: EngineRuntime | null;
      unavailableReason: string | null;
      current: InstalledEngine | null;
      packSources?: { source: string; error: string | null }[];
      install?: EngineInstallRun | null;
    };
  }>(`/api/v1/client/servers/${serverId}/engine${params}`);

  return { ...data, ...meta, packSources: meta.packSources ?? [], install: meta.install ?? null };
}

/**
 * Remplace le moteur du serveur.
 *
 * Ni l'adresse ni le nom de fichier ne partent d'ici : seul le couple
 * « quel moteur, quelle version » est transmis, et l'API résout le reste. Une
 * URL venue du navigateur ferait du daemon un téléchargeur de fichiers
 * arbitraires.
 *
 * L'API répond dès l'installation lancée (202) : elle se poursuit en tâche de
 * fond, et l'écran en relit l'état (`EngineState.install`) jusqu'à sa fin.
 * Attendre ici la fin d'un modpack dépassait l'échéance des appels (10 s) : on
 * voyait une erreur, jamais le compte rendu.
 */
export async function installEngine(
  serverId: string,
  optionId: string,
  versionId: string,
  backupFirst = false,
): Promise<{ error: string | null; run: EngineInstallRun | null }> {
  try {
    const { data } = await apiSendFor<{ data: EngineInstallRun }>(
      `/api/v1/client/servers/${serverId}/engine/install`,
      { optionId, versionId, backupFirst },
    );
    revalidatePath(`/server/${serverId}/engine`);
    return { error: null, run: data };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Opération refusée.", run: null };
  }
}

/**
 * Le serveur peut-il prendre une sauvegarde préalable ?
 *
 * Lecture d'appoint : un sous-utilisateur sans droit sur les sauvegardes voit
 * l'écran du moteur quand même, sans l'option (`null`). Un quota nul le dit
 * aussi : proposer une sauvegarde que l'API refusera ne servirait à rien.
 */
export async function fetchBackupRoom(serverId: string): Promise<boolean | null> {
  try {
    const { meta } = await apiReadFor<{ meta: { used: number; limit: number } }>(
      `/api/v1/client/servers/${serverId}/backups`,
    );
    return meta.limit > 0;
  } catch {
    return null;
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
