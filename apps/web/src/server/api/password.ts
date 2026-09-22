"use server";

import type { PasswordProblem } from "@gamedashboard/contracts";
import { revalidatePath } from "next/cache";
import { ApiError, apiSendFor } from "./client";

export interface PasswordChangeResult {
  /** Nombre d'autres sessions fermées par le changement, `null` en cas d'échec. */
  revokedSessions: number | null;
  /**
   * Vrai quand HaveIBeenPwned n'a pas répondu et que le contrôle des fuites a
   * donc été sauté. Le changement a bien eu lieu — refuser un mot de passe sain
   * parce qu'un service tiers est en panne pénaliserait sans rien protéger —
   * mais l'écran doit le dire plutôt que de laisser croire à une vérification
   * qui n'a pas eu lieu.
   */
  pwnedCheckFailed: boolean;
  /**
   * Manquements structurés, pour que l'écran les traduise.
   *
   * Vide quand le refus n'est pas une affaire de politique — mot de passe
   * actuel faux, compte sans mot de passe local — auquel cas seul `error`
   * porte l'explication.
   */
  problems: PasswordProblem[];
  error: string | null;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<PasswordChangeResult> {
  try {
    const { data } = await apiSendFor<{
      data: { revokedSessions: number; pwnedCheckFailed: boolean };
    }>("/api/v1/auth/password", { currentPassword, newPassword });

    // Les autres sessions viennent de tomber : la liste affichée juste au-dessus
    // est périmée à la seconde même où ce formulaire aboutit.
    revalidatePath("/account/security");
    return { ...data, revokedSessions: data.revokedSessions, problems: [], error: null };
  } catch (error) {
    return {
      revokedSessions: null,
      pwnedCheckFailed: false,
      problems: problemsOf(error),
      error: error instanceof Error ? error.message : "Opération refusée.",
    };
  }
}

/** Extrait les manquements du corps du refus, s'il en porte. */
function problemsOf(error: unknown): PasswordProblem[] {
  if (!(error instanceof ApiError)) return [];
  const problems = error.details.problems;
  return Array.isArray(problems) ? (problems as PasswordProblem[]) : [];
}
