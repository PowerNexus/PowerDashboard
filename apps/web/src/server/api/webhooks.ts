"use server";

import { revalidatePath } from "next/cache";
import { apiFetch, apiSendFor } from "./client";

export interface PlatformWebhook {
  id: string;
  applicationKeyId: string;
  applicationKeyName: string;
  url: string;
  events: string[];
  isActive: boolean;
  /** Nul tant qu'aucun rappel n'est jamais parvenu : distinct d'un échec. */
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  attempts: number;
  responseStatus: number | null;
  responseBody: string | null;
  /** Prochaine tentative. `null` signifie « plus jamais » — livré, ou abandonné. */
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  abandonedAt: string | null;
  createdAt: string;
}

export async function fetchWebhooks(): Promise<PlatformWebhook[]> {
  const { data } = await apiFetch<{ data: PlatformWebhook[] }>("/api/v1/admin/webhooks");
  return data;
}

export async function fetchWebhookDeliveries(): Promise<WebhookDelivery[]> {
  const { data } = await apiFetch<{ data: WebhookDelivery[] }>("/api/v1/admin/webhooks/deliveries");
  return data;
}

/**
 * Déclare un point d'entrée et rend son secret de signature, une seule fois.
 *
 * Le secret est chiffré en base parce qu'il faut le relire pour signer, mais il
 * n'est jamais réaffiché : un écran d'administration compromis deviendrait
 * sinon une source de signatures valides.
 */
export async function createWebhook(input: {
  applicationKeyId: string;
  url: string;
  events: string[];
}): Promise<{ secret: string | null; error: string | null }> {
  try {
    const { data } = await apiSendFor<{ data: { secret: string } }>(
      "/api/v1/admin/webhooks",
      input,
    );
    revalidatePath("/admin/api");
    return { secret: data.secret, error: null };
  } catch (error) {
    return { secret: null, error: error instanceof Error ? error.message : "Création refusée." };
  }
}

export async function rotateWebhookSecret(
  webhookId: string,
): Promise<{ secret: string | null; error: string | null }> {
  try {
    const { data } = await apiSendFor<{ data: { secret: string } }>(
      `/api/v1/admin/webhooks/${webhookId}/secret`,
      {},
    );
    revalidatePath("/admin/api");
    return { secret: data.secret, error: null };
  } catch (error) {
    return { secret: null, error: error instanceof Error ? error.message : "Rotation refusée." };
  }
}

export async function setWebhookActive(
  webhookId: string,
  active: boolean,
): Promise<{ error: string | null }> {
  try {
    await apiSendFor(`/api/v1/admin/webhooks/${webhookId}/active`, { active });
    revalidatePath("/admin/api");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Opération refusée." };
  }
}

export async function deleteWebhook(webhookId: string): Promise<{ error: string | null }> {
  try {
    await apiSendFor(`/api/v1/admin/webhooks/${webhookId}`, undefined, "DELETE");
    revalidatePath("/admin/api");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Suppression refusée." };
  }
}
