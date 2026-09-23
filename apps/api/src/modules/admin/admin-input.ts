import { BadRequestException } from "@nestjs/common";
import type { z } from "zod";
import type { AuthenticatedRequest } from "../auth/session.guard";

/** `AuthenticatedRequest` ne porte pas l'adresse : Fastify la pose à part. */
export type AdminRequest = AuthenticatedRequest & { ip?: string };

/**
 * Valide un corps de requête, ou refuse en disant quel champ pèche.
 *
 * Le chemin du champ précède le message : « Too small » seul ne dit pas à qui
 * remplit un formulaire de douze champs lequel corriger.
 */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return parsed.data;

  const issue = parsed.error.issues[0];
  const field = issue?.path.join(".") ?? "";
  throw new BadRequestException(
    field
      ? `Champ « ${field} » invalide : ${issue?.message}`
      : (issue?.message ?? "Requête invalide."),
  );
}
