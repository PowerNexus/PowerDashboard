"use server";

import { revalidatePath } from "next/cache";
import { apiFetch, apiSend, apiSendFor } from "./client";

export interface ApiKey {
  id: string;
  name: string;
  /** Partie visible. Le secret n'existe plus nulle part après la création. */
  prefix: string;
  scopes: string[];
  allowedIps: string[];
  lastUsedAt: string | null;
  /** `null` : la clé n'expire pas. */
  expiresAt: string | null;
  createdAt: string;
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const { data } = await apiFetch<{ data: ApiKey[] }>("/api/v1/client/account/api-keys");
  return data;
}

/**
 * Crée une clé et rend le secret.
 *
 * C'est la seule fois où il est disponible : l'API n'en conserve qu'un
 * condensat. L'écran doit donc le montrer maintenant, ou jamais.
 */
export async function createApiKey(
  name: string,
  scopes: string[],
  allowedIps: string[],
  /** Jours de validité ; `null` pour une clé sans fin. */
  expiresInDays: number | null = null,
): Promise<{ plaintext: string | null; error: string | null }> {
  try {
    const { data } = await apiSendFor<{ data: { plaintext: string } }>(
      "/api/v1/client/account/api-keys",
      { name, scopes, allowedIps, expiresInDays },
    );
    revalidatePath("/account/api-keys");
    return { plaintext: data.plaintext, error: null };
  } catch (error) {
    return { plaintext: null, error: message(error) };
  }
}

export async function revokeApiKey(keyId: string): Promise<{ error: string | null }> {
  try {
    await apiSend(`/api/v1/client/account/api-keys/${keyId}`, undefined, "DELETE");
    revalidatePath("/account/api-keys");
    return { error: null };
  } catch (error) {
    return { error: message(error) };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Opération refusée.";
}
