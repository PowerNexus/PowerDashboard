"use server";

import { revalidatePath } from "next/cache";
import { apiFetch, apiSend, apiSendFor } from "./client";

export interface DatabaseHost {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  nodeId: string | null;
  nodeName: string | null;
  maxDatabases: number | null;
  /** Bases hébergées : c'est ce nombre qui décide si l'hôte peut être retiré. */
  databases: number;
}

export interface DatabaseHostForm {
  name: string;
  host: string;
  port: number;
  username: string;
  /** Vide à la mise à jour signifie « ne change pas le mot de passe ». */
  password: string;
  nodeId: string | null;
  maxDatabases: number | null;
}

export const fetchDatabaseHosts = async (): Promise<DatabaseHost[]> => {
  const { data } = await apiFetch<{ data: DatabaseHost[] }>("/api/v1/admin/database-hosts");
  return data;
};

/**
 * Éprouve des identifiants sans rien enregistrer.
 *
 * Le résultat dit deux choses distinctes : l'hôte répond, et le compte peut
 * créer des utilisateurs. Un compte capable de se connecter mais pas de créer
 * passerait le premier contrôle et échouerait au premier usage réel — autant le
 * savoir maintenant.
 */
export async function testDatabaseHost(
  form: DatabaseHostForm,
): Promise<{ version: string; canCreate: boolean } | { error: string }> {
  try {
    const { data } = await apiSendFor<{ data: { version: string; canCreate: boolean } }>(
      "/api/v1/admin/database-hosts/test",
      form,
    );
    return data;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Test impossible." };
  }
}

export async function saveDatabaseHost(
  form: DatabaseHostForm,
  hostId?: string,
): Promise<{ error: string | null }> {
  return act(() =>
    apiSend(
      hostId ? `/api/v1/admin/database-hosts/${hostId}` : "/api/v1/admin/database-hosts",
      form,
    ),
  );
}

export async function deleteDatabaseHost(hostId: string): Promise<{ error: string | null }> {
  return act(() => apiSend(`/api/v1/admin/database-hosts/${hostId}`, undefined, "DELETE"));
}

async function act(call: () => Promise<void>): Promise<{ error: string | null }> {
  try {
    await call();
    revalidatePath("/admin/database-hosts");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Opération refusée." };
  }
}
