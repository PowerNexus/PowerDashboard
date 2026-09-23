"use server";

import type { AdminUserPatch } from "@gamedashboard/contracts";
import { revalidatePath } from "next/cache";
import { apiSendFor } from "./client";

/**
 * Modification d'un compte depuis l'administration : corriger, envoyer un lien
 * de réinitialisation, suspendre ou réactiver.
 *
 * Aucune de ces actions ne rend un secret : le lien de réinitialisation part
 * au titulaire, jamais à l'administrateur.
 */

function failure(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function updateUser(
  userId: string,
  patch: AdminUserPatch,
): Promise<{
  error: string | null;
  emailChanged: boolean;
  verification: "sent" | "mail_disabled" | "throttled" | null;
}> {
  try {
    const { data } = await apiSendFor<{
      data: { emailChanged: boolean; verification: "sent" | "mail_disabled" | "throttled" | null };
    }>(`/api/v1/admin/users/${userId}`, patch);
    revalidatePath("/admin/users");
    return { error: null, ...data };
  } catch (error) {
    return {
      error: failure(error, "Modification refusée."),
      emailChanged: false,
      verification: null,
    };
  }
}

export async function sendPasswordReset(
  userId: string,
): Promise<{ error: string | null; sentTo: string | null }> {
  try {
    const { data } = await apiSendFor<{ data: { sentTo: string } }>(
      `/api/v1/admin/users/${userId}/password-reset`,
      {},
    );
    return { error: null, sentTo: data.sentTo };
  } catch (error) {
    return { error: failure(error, "Envoi refusé."), sentTo: null };
  }
}

export async function setUserSuspended(
  userId: string,
  input: { suspended: true; reason: string } | { suspended: false },
): Promise<{ error: string | null; revokedSessions: number }> {
  try {
    const { data } = await apiSendFor<{ data: { revokedSessions: number } }>(
      `/api/v1/admin/users/${userId}/suspend`,
      input,
    );
    revalidatePath("/admin/users");
    return { error: null, revokedSessions: data.revokedSessions };
  } catch (error) {
    return { error: failure(error, "Suspension refusée."), revokedSessions: 0 };
  }
}
