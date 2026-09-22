"use server";

import { revalidatePath } from "next/cache";
import { apiFetch, apiSendFor } from "./client";

export interface ApplicationKey {
  id: string;
  name: string;
  /** Partie visible de la clé. Le secret, lui, n'est jamais relisible. */
  prefix: string;
  scopes: string[];
  allowedIps: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export async function fetchApplicationKeys(): Promise<ApplicationKey[]> {
  const { data } = await apiFetch<{ data: ApplicationKey[] }>("/api/v1/admin/application-keys");
  return data;
}

/**
 * Crée une clé et rend le secret **une seule fois**.
 *
 * Le secret traverse cette fonction et s'arrête à l'écran : il n'est ni
 * journalisé, ni mis en cache, ni relisible ensuite — la base n'en garde qu'un
 * condensat. Une clé égarée se remplace, elle ne se retrouve pas, et c'est ce
 * qui fait qu'une fuite de la base ne livre aucune clé utilisable.
 */
export async function createApplicationKey(input: {
  name: string;
  scopes: string[];
  allowedIps: string[];
  expiresInDays: number;
}): Promise<{ plaintext: string | null; error: string | null }> {
  try {
    const { data } = await apiSendFor<{ data: { plaintext: string } }>(
      "/api/v1/admin/application-keys",
      input,
    );
    revalidatePath("/admin/api");
    return { plaintext: data.plaintext, error: null };
  } catch (error) {
    return {
      plaintext: null,
      error: error instanceof Error ? error.message : "Création refusée.",
    };
  }
}

export async function revokeApplicationKey(keyId: string): Promise<{ error: string | null }> {
  try {
    await apiSendFor(`/api/v1/admin/application-keys/${keyId}`, undefined, "DELETE");
    revalidatePath("/admin/api");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Révocation refusée." };
  }
}
