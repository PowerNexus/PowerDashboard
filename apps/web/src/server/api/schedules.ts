"use server";

import type { CronFields } from "@gamedashboard/contracts";
import { revalidatePath } from "next/cache";
import { apiFetch, apiSend } from "./client";

export type ScheduleAction = "command" | "power" | "backup";

export interface ScheduleTask {
  id?: string;
  action: ScheduleAction;
  payload: string;
  timeOffset: number;
  continueOnFailure: boolean;
}

export interface Schedule {
  id: string;
  name: string;
  cron: CronFields;
  isActive: boolean;
  onlyWhenOnline: boolean;
  lastRunAt: string | null;
  /** Cause de l'échec de la dernière exécution, `null` si elle a réussi. */
  lastRunFailure: string | null;
  /** `null` = en pause, ou expression qui ne survient jamais. */
  nextRunAt: string | null;
  tasks: ScheduleTask[];
}

export interface ScheduleInput {
  name: string;
  cron: CronFields;
  isActive: boolean;
  onlyWhenOnline: boolean;
  tasks: ScheduleTask[];
}

export async function listSchedules(serverId: string): Promise<Schedule[]> {
  const { data } = await apiFetch<{ data: Schedule[] }>(
    `/api/v1/client/servers/${serverId}/schedules`,
  );
  return data;
}

export async function createSchedule(
  serverId: string,
  input: ScheduleInput,
): Promise<{ error: string | null }> {
  return act(serverId, () => apiSend(`/api/v1/client/servers/${serverId}/schedules`, input));
}

export async function updateSchedule(
  serverId: string,
  scheduleId: string,
  input: ScheduleInput,
): Promise<{ error: string | null }> {
  return act(serverId, () =>
    apiSend(`/api/v1/client/servers/${serverId}/schedules/${scheduleId}`, input),
  );
}

export async function setScheduleActive(
  serverId: string,
  scheduleId: string,
  active: boolean,
): Promise<{ error: string | null }> {
  return act(serverId, () =>
    apiSend(`/api/v1/client/servers/${serverId}/schedules/${scheduleId}/active`, { active }),
  );
}

export async function runScheduleNow(
  serverId: string,
  scheduleId: string,
): Promise<{ error: string | null }> {
  return act(serverId, () =>
    apiSend(`/api/v1/client/servers/${serverId}/schedules/${scheduleId}/run`, {}),
  );
}

export async function deleteSchedule(
  serverId: string,
  scheduleId: string,
): Promise<{ error: string | null }> {
  return act(serverId, () =>
    apiSend(`/api/v1/client/servers/${serverId}/schedules/${scheduleId}`, undefined, "DELETE"),
  );
}

async function act(serverId: string, call: () => Promise<void>): Promise<{ error: string | null }> {
  try {
    await call();
    revalidatePath(`/server/${serverId}/schedules`);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Opération refusée." };
  }
}
