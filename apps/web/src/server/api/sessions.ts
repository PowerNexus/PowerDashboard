"use server";

import { revalidatePath } from "next/cache";
import { apiFetch, apiSend, apiSendFor } from "./client";

/**
 * Session telle que l'API la rend.
 *
 * Pas de champ « localisation » : le panel ne dispose d'aucune base de
 * géolocalisation, et déduire une ville d'une adresse IP donnerait une réponse
 * fausse une fois sur plusieurs — VPN, IP mobile, opérateur dont le bloc est
 * déclaré ailleurs. Écrire « Bordeaux » à quelqu'un qui est à Agen le ferait
 * chercher une intrusion qui n'existe pas ; ne rien écrire lui laisse
 * l'adresse, qui est vraie.
 */
export interface AccountSession {
  id: string;
  ip: string | null;
  userAgent: string | null;
  /** Nom donné par l'utilisateur, quand il y en aura un. Pas encore alimenté. */
  deviceLabel: string | null;
  /** Par quel moyen cette session a été ouverte. */
  authMethod: string;
  createdAt: string;
  /** `null` pour une session ouverte avant que la colonne n'existe. */
  lastSeenAt: string | null;
  expiresAt: string;
  isCurrent: boolean;
}

export async function listSessions(): Promise<AccountSession[]> {
  const { data } = await apiFetch<{ data: AccountSession[] }>("/api/v1/auth/sessions");
  return data;
}

export async function revokeSession(sessionId: string): Promise<{ error: string | null }> {
  try {
    await apiSend(`/api/v1/auth/sessions/${sessionId}`, undefined, "DELETE");
    revalidatePath("/account/security");
    return { error: null };
  } catch (error) {
    return { error: message(error) };
  }
}

/**
 * Ferme toutes les autres sessions.
 *
 * Le décompte remonte jusqu'à l'écran : « 3 sessions fermées » se vérifie d'un
 * coup d'œil contre la liste qu'on avait sous les yeux, là où un « c'est fait »
 * laisse entier le doute sur l'appareil qu'on voulait couper.
 */
export async function revokeOtherSessions(): Promise<{
  revoked: number | null;
  error: string | null;
}> {
  try {
    const { data } = await apiSendFor<{ data: { revoked: number } }>(
      "/api/v1/auth/sessions",
      undefined,
      "DELETE",
    );
    revalidatePath("/account/security");
    return { revoked: data.revoked, error: null };
  } catch (error) {
    return { revoked: null, error: message(error) };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Opération refusée.";
}
