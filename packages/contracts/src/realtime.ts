import { z } from "zod";
import { ServerResources, ServerState } from "./server";

/** Événements émis par le gateway vers le client, room `server:{id}`. */
export const ServerEvents = {
  status: ServerState,
  "console.output": z.array(z.string()),
  stats: ServerResources,
  "install.output": z.array(z.string()),
  "install.completed": z.object({ success: z.boolean() }),
  "backup.progress": z.object({ backupId: z.string().uuid(), pct: z.number().min(0).max(100) }),
  "backup.completed": z.object({ backupId: z.string().uuid(), success: z.boolean() }),
  "daemon.error": z.object({ message: z.string() }),
} as const;

export type ServerEventName = keyof typeof ServerEvents;
export type ServerEventPayload<E extends ServerEventName> = z.infer<(typeof ServerEvents)[E]>;

/** Événements émis par le client vers le gateway. */
export const ClientEvents = {
  "console.send": z.object({ command: z.string().min(1).max(4096) }),
  power: z.object({ signal: z.enum(["start", "stop", "restart", "kill"]) }),
  "console.history": z.object({ lines: z.number().int().min(1).max(2000).default(500) }),
} as const;

export type ClientEventName = keyof typeof ClientEvents;
