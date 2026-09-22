import { z } from "zod";

export const UserRole = z.enum(["admin", "support", "reseller", "user"]);
export type UserRole = z.infer<typeof UserRole>;

export const User = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  role: UserRole,
  locale: z.enum(["fr", "en"]).default("fr"),
  is2faEnabled: z.boolean(),
  avatarUrl: z.string().url().nullable(),
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof User>;

/*
 * Les formes d'entrée de la connexion et de l'inscription vivaient ici, et
 * elles ont été retirées.
 *
 * Personne ne les lisait — l'API valide avec ses propres schémas — et elles
 * **contredisaient** le panel : toutes deux exigeaient un `turnstileToken`,
 * alors que le contrôle anti-automate est facultatif et qu'aucune installation
 * ne l'avait. Un schéma que rien n'applique et qui décrit une règle fausse est
 * un piège pour qui viendra s'y fier.
 */
