"use server";

import { revalidatePath } from "next/cache";
import { apiFetch, apiSend, apiSendFor } from "./client";

export interface ServerDatabase {
  id: string;
  name: string;
  username: string;
  host: string;
  port: number;
  remote: string;
  hostName: string;
  createdAt: string;
}

export interface DatabaseList {
  items: ServerDatabase[];
  used: number;
  limit: number;
}

export async function listDatabases(serverId: string): Promise<DatabaseList> {
  const { data, meta } = await apiFetch<{
    data: ServerDatabase[];
    meta: { used: number; limit: number };
  }>(`/api/v1/client/servers/${serverId}/databases`);

  return { items: data, used: meta.used, limit: meta.limit };
}

export async function createDatabase(
  serverId: string,
  name: string,
  remote: string,
): Promise<{ error: string | null }> {
  return act(serverId, () =>
    apiSend(`/api/v1/client/servers/${serverId}/databases`, { name, remote }),
  );
}

export async function deleteDatabase(
  serverId: string,
  databaseId: string,
): Promise<{ error: string | null }> {
  return act(serverId, () =>
    apiSend(`/api/v1/client/servers/${serverId}/databases/${databaseId}`, undefined, "DELETE"),
  );
}

/**
 * Mot de passe d'une base, à la demande.
 *
 * Il n'est ni rendu avec la liste, ni conservé côté navigateur : il est demandé
 * au moment où quelqu'un clique pour le voir, et disparaît avec la boîte de
 * dialogue.
 */
export async function revealDatabasePassword(
  serverId: string,
  databaseId: string,
): Promise<{ password: string | null; error: string | null }> {
  try {
    const { data } = await apiFetch<{ data: { password: string } }>(
      `/api/v1/client/servers/${serverId}/databases/${databaseId}/password`,
    );
    return { password: data.password, error: null };
  } catch (error) {
    return { password: null, error: message(error) };
  }
}

export async function rotateDatabasePassword(
  serverId: string,
  databaseId: string,
): Promise<{ password: string | null; error: string | null }> {
  try {
    const { data } = await apiSendFor<{ data: { password: string } }>(
      `/api/v1/client/servers/${serverId}/databases/${databaseId}/rotate`,
      {},
    );
    revalidatePath(`/server/${serverId}/databases`);
    return { password: data.password, error: null };
  } catch (error) {
    return { password: null, error: message(error) };
  }
}

async function act(serverId: string, call: () => Promise<void>): Promise<{ error: string | null }> {
  try {
    await call();
    revalidatePath(`/server/${serverId}/databases`);
    return { error: null };
  } catch (error) {
    return { error: message(error) };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Opération refusée.";
}
