"use server";

import { apiSend } from "./client";
import { forwardedIdentityHeaders } from "./forwarded";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";

/**
 * Confirme une adresse à partir du jeton reçu par courrier.
 *
 * Sans session, volontairement : on clique sur ce lien depuis sa boîte, souvent
 * sur un autre appareil que celui où l'on était connecté. Exiger une session
 * ferait échouer le geste le plus naturel du parcours — et ce clic n'ouvre
 * aucun accès, il atteste seulement qu'on lit cette boîte.
 */
export async function confirmEmail(token: string): Promise<{ error: string | null }> {
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/email/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await forwardedIdentityHeaders()) },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });

    if (response.ok) return { error: null };

    const body = (await response.json().catch(() => ({}))) as { message?: string };
    return { error: body.message ?? "Ce lien n'est plus valable." };
  } catch {
    return { error: "Le panel est injoignable. Réessayez dans un instant." };
  }
}

/** Redemande le courrier de confirmation pour le compte connecté. */
export async function resendVerificationEmail(): Promise<{ error: string | null }> {
  try {
    await apiSend("/api/v1/auth/email/verify/send", {});
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Envoi impossible." };
  }
}
