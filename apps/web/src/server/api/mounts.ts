"use server";

import { revalidatePath } from "next/cache";
import { apiFetch, apiSend } from "./client";

export interface Mount {
  id: string;
  name: string;
  source: string;
  target: string;
  readOnly: boolean;
  userMountable: boolean;
  /** Serveurs qui le portent : décide de ce qu'une suppression retirerait. */
  servers: number;
}

export interface MountForm {
  name: string;
  source: string;
  target: string;
  readOnly: boolean;
  userMountable: boolean;
}

export const fetchMounts = async (): Promise<Mount[]> => {
  const { data } = await apiFetch<{ data: Mount[] }>("/api/v1/admin/mounts");
  return data;
};

export async function saveMount(
  form: MountForm,
  mountId?: string,
): Promise<{ error: string | null }> {
  return act(() =>
    apiSend(mountId ? `/api/v1/admin/mounts/${mountId}` : "/api/v1/admin/mounts", form),
  );
}

export async function deleteMount(mountId: string): Promise<{ error: string | null }> {
  return act(() => apiSend(`/api/v1/admin/mounts/${mountId}`, undefined, "DELETE"));
}

async function act(call: () => Promise<void>): Promise<{ error: string | null }> {
  try {
    await call();
    revalidatePath("/admin/mounts");
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Opération refusée." };
  }
}
