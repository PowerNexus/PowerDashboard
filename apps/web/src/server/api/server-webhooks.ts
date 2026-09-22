"use server";

import { revalidatePath } from "next/cache";
import { apiFetch, apiSend, apiSendFor } from "./client";

/**
 * Rappels sortants déclarés par le client sur son serveur.
 *
 * À ne pas confondre avec `webhooks.ts`, qui pilote ceux de la **plateforme**
 * vers un système tiers et vit dans l'administration. Ceux-ci appartiennent au
 * propriétaire du serveur et ne parlent que de lui.
 */

export interface ServerWebhook {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
}

export interface ServerWebhookDelivery {
  id: string;
  event: string;
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  deliveredAt: string | null;
  abandonedAt: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
}

export async function listServerWebhooks(serverId: string): Promise<ServerWebhook[]> {
  const { data } = await apiFetch<{ data: ServerWebhook[] }>(
    `/api/v1/client/servers/${serverId}/webhooks`,
  );
  return data;
}

export async function listDeliveries(
  serverId: string,
  webhookId: string,
): Promise<{ deliveries: ServerWebhookDelivery[]; error: string | null }> {
  try {
    const { data } = await apiFetch<{ data: ServerWebhookDelivery[] }>(
      `/api/v1/client/servers/${serverId}/webhooks/${webhookId}/deliveries`,
    );
    return { deliveries: data, error: null };
  } catch (error) {
    return { deliveries: [], error: messageOf(error) };
  }
}

/**
 * Déclare un rappel et rend son secret.
 *
 * **C'est la seule fois où il traverse le réseau vers l'écran.** Aucune lecture
 * ne le rend ensuite : celui qui le perd en demande un nouveau. Un accès en
 * lecture au panel ne doit pas suffire à contrefaire des rappels signés.
 */
export async function createServerWebhook(
  serverId: string,
  input: { url: string; events: string[] },
): Promise<{ secret: string | null; error: string | null }> {
  try {
    const { data } = await apiSendFor<{ data: { secret: string } }>(
      `/api/v1/client/servers/${serverId}/webhooks`,
      input,
    );
    revalidatePath(`/server/${serverId}/webhooks`);
    return { secret: data.secret, error: null };
  } catch (error) {
    return { secret: null, error: messageOf(error) };
  }
}

export async function updateServerWebhook(
  serverId: string,
  webhookId: string,
  input: { url?: string; events?: string[]; isActive?: boolean },
): Promise<{ error: string | null }> {
  return act(
    () => apiSend(`/api/v1/client/servers/${serverId}/webhooks/${webhookId}`, input),
    serverId,
  );
}

export async function rotateServerWebhook(
  serverId: string,
  webhookId: string,
): Promise<{ secret: string | null; error: string | null }> {
  try {
    const { data } = await apiSendFor<{ data: { secret: string } }>(
      `/api/v1/client/servers/${serverId}/webhooks/${webhookId}/rotate`,
      {},
    );
    revalidatePath(`/server/${serverId}/webhooks`);
    return { secret: data.secret, error: null };
  } catch (error) {
    return { secret: null, error: messageOf(error) };
  }
}

export async function deleteServerWebhook(
  serverId: string,
  webhookId: string,
): Promise<{ error: string | null }> {
  return act(
    () => apiSend(`/api/v1/client/servers/${serverId}/webhooks/${webhookId}`, {}, "DELETE"),
    serverId,
  );
}

async function act(call: () => Promise<void>, serverId: string): Promise<{ error: string | null }> {
  try {
    await call();
    revalidatePath(`/server/${serverId}/webhooks`);
    return { error: null };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Opération refusée.";
}
