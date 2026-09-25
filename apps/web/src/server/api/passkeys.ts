"use server";

import { revalidatePath } from "next/cache";
import { apiFetch, apiSend, apiSendFor } from "./client";

export interface Passkey {
  id: string;
  label: string;
  /** « usb », « nfc », « internal »… tels que l'authentifiant les a déclarés. */
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
  /** Domaine d'un revendeur où la clé a été créée : elle ne sert que là. `null` : la plateforme. */
  domain: string | null;
}

export async function listPasskeys(): Promise<Passkey[]> {
  const { data } = await apiFetch<{ data: Passkey[] }>("/api/v1/auth/2fa/passkeys");
  return data;
}

/**
 * Options de la cérémonie d'enregistrement, contre le mot de passe du compte.
 *
 * `options` est passé tel quel à `navigator.credentials.create()` par le
 * navigateur ; `challenge` est le jeton scellé à renvoyer avec la réponse. Ni
 * l'un ni l'autre n'est interprété ici : l'action serveur ne fait que relayer.
 * Le mot de passe est demandé ici, avant que la boîte de dialogue du
 * navigateur ne prenne la main ; vide pour un compte qui n'en a pas.
 */
export async function passkeyRegistrationOptions(password: string): Promise<{
  options: unknown;
  challenge: string;
  error: string | null;
}> {
  try {
    const { data } = await apiSendFor<{ data: { options: unknown; challenge: string } }>(
      "/api/v1/auth/2fa/passkeys/options",
      { password },
    );
    return { ...data, error: null };
  } catch (error) {
    return { options: null, challenge: "", error: message(error) };
  }
}

/**
 * Range la clé et rend les codes de secours s'il a fallu les créer.
 *
 * `recoveryCodes` n'est renseigné que la première fois qu'une seconde preuve
 * est posée sur le compte : sans eux, protéger son accès par une seule clé
 * reviendrait à parier sur un objet qui se perd.
 */
export async function registerPasskey(
  challenge: string,
  label: string,
  response: unknown,
): Promise<{ recoveryCodes: string[] | null; error: string | null }> {
  try {
    const { data } = await apiSendFor<{ data: { recoveryCodes: string[] | null } }>(
      "/api/v1/auth/2fa/passkeys",
      { challenge, label, response },
    );
    revalidatePath("/account/security");
    return { recoveryCodes: data.recoveryCodes, error: null };
  } catch (error) {
    return { recoveryCodes: null, error: message(error) };
  }
}

export async function removePasskey(
  id: string,
  password: string,
): Promise<{ error: string | null }> {
  try {
    await apiSend(`/api/v1/auth/2fa/passkeys/${id}`, { password }, "DELETE");
    revalidatePath("/account/security");
    return { error: null };
  } catch (error) {
    return { error: message(error) };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Opération refusée.";
}
