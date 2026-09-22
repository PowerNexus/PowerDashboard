"use server";

import { revalidatePath } from "next/cache";
import { apiFetch, apiSendFor } from "./client";
import type { PlatformWebhook, WebhookDelivery } from "./webhooks";

/**
 * Les rappels sortants d'un revendeur.
 *
 * Les mêmes gestes que côté administration, sur les routes de l'espace
 * revendeur : celles qui bornent tout au périmètre de la session. Le revendeur
 * ne désigne jamais de qui il parle — c'est sa session qui le dit, et c'est ce
 * qui l'empêche de brancher un rappel sur la clé d'un confrère pour en
 * recevoir le trafic.
 */

export async function fetchResellerWebhooks(): Promise<PlatformWebhook[]> {
  const { data } = await apiFetch<{ data: PlatformWebhook[] }>("/api/v1/reseller/webhooks");
  return data;
}

/**
 * Ses dernières livraisons.
 *
 * L'onglet de diagnostic : c'est là qu'on regarde quand une boutique est
 * muette. Sans lui, la réponse serait dans les journaux du processus — donc
 * chez nous, donc nulle part pour lui.
 */
export async function fetchResellerWebhookDeliveries(): Promise<WebhookDelivery[]> {
  const { data } = await apiFetch<{ data: WebhookDelivery[] }>(
    "/api/v1/reseller/webhooks/deliveries",
  );
  return data;
}

/**
 * Déclare un point d'entrée et rend son secret de signature, **une seule fois**.
 *
 * Il traverse cette fonction et s'arrête à l'écran : ni journalisé, ni mis en
 * cache, ni relisible ensuite. La base le garde chiffré parce qu'il faut le
 * relire pour signer, mais le réafficher ferait d'un écran compromis une source
 * de signatures valides.
 */
export async function createResellerWebhook(input: {
  applicationKeyId: string;
  url: string;
  events: string[];
}): Promise<{ secret: string | null; error: string | null }> {
  try {
    const { data } = await apiSendFor<{ data: { secret: string } }>(
      "/api/v1/reseller/webhooks",
      input,
    );
    revalidatePath("/reseller/webhooks");
    return { secret: data.secret, error: null };
  } catch (error) {
    return { secret: null, error: error instanceof Error ? error.message : "Création refusée." };
  }
}

export async function rotateResellerWebhookSecret(
  webhookId: string,
): Promise<{ secret: string | null; error: string | null }> {
  try {
    const { data } = await apiSendFor<{ data: { secret: string } }>(
      `/api/v1/reseller/webhooks/${webhookId}/secret`,
      {},
    );
    revalidatePath("/reseller/webhooks");
    return { secret: data.secret, error: null };
  } catch (error) {
    return { secret: null, error: error instanceof Error ? error.message : "Rotation refusée." };
  }
}

export async function setResellerWebhookActive(
  webhookId: string,
  active: boolean,
): Promise<{ error: string | null }> {
  try {
    await apiSendFor(`/api/v1/reseller/webhooks/${webhookId}/active`, { active });
    revalidatePath("/reseller/webhooks");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Opération refusée." };
  }
}

export async function deleteResellerWebhook(webhookId: string): Promise<{ error: string | null }> {
  try {
    await apiSendFor(`/api/v1/reseller/webhooks/${webhookId}`, undefined, "DELETE");
    revalidatePath("/reseller/webhooks");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Suppression refusée." };
  }
}
