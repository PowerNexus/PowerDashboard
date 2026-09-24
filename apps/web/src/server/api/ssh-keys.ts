"use server";

import { revalidatePath } from "next/cache";
import { apiFetch, apiSend } from "./client";

/**
 * Clé publique SSH d'un compte.
 *
 * Le corps de la clé n'en fait pas partie : il n'apprend rien à qui l'a
 * enregistrée, et l'empreinte suffit à reconnaître laquelle — c'est d'ailleurs
 * ce que `ssh-keygen -lf` affiche, donc ce qu'on peut comparer.
 */
export interface SshKey {
  id: string;
  name: string;
  algorithm: string;
  fingerprint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export const listSshKeys = async (): Promise<SshKey[]> => {
  const { data } = await apiFetch<{ data: SshKey[] }>("/api/v1/auth/ssh-keys");
  return data;
};

/**
 * Ajoute une clé, contre le mot de passe du compte : elle ouvre les fichiers
 * de tous ses serveurs et survit à la session. Vide pour un compte sans mot
 * de passe local.
 */
export async function addSshKey(
  name: string,
  publicKey: string,
  password: string,
): Promise<{ error: string | null }> {
  return act(() => apiSend("/api/v1/auth/ssh-keys", { name, publicKey, password }));
}

export async function removeSshKey(keyId: string): Promise<{ error: string | null }> {
  return act(() => apiSend(`/api/v1/auth/ssh-keys/${keyId}`, undefined, "DELETE"));
}

/**
 * Le refus de l'API est rendu tel quel.
 *
 * « la ligne a été coupée » et « ce type de clé n'est pas accepté » se
 * corrigent de deux façons différentes ; les fondre en « clé invalide » ferait
 * recoller la même clé une troisième fois.
 */
async function act(call: () => Promise<void>): Promise<{ error: string | null }> {
  try {
    await call();
    revalidatePath("/account/security");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Opération refusée." };
  }
}
