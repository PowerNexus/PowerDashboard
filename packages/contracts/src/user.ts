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

/**
 * Ce que l'administration modifie d'un compte.
 *
 * Ni le rôle — il a sa route, avec ses gardes — ni le mot de passe : un
 * administrateur ne choisit jamais le secret d'un autre, il déclenche la
 * réinitialisation et l'intéressé choisit lui-même.
 */
export const AdminUserPatch = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  nameFirst: z.string().trim().min(1).max(100),
  nameLast: z.string().trim().min(1).max(100),
  locale: z.enum(["fr", "en"]),
});
export type AdminUserPatch = z.infer<typeof AdminUserPatch>;

/**
 * Suspension d'un compte, ou sa levée.
 *
 * Le motif est exigé à la suspension : c'est la première chose que le support
 * voudra savoir quand le client appellera.
 */
export const UserSuspensionInput = z.discriminatedUnion("suspended", [
  z.object({ suspended: z.literal(true), reason: z.string().trim().min(1).max(500) }),
  z.object({ suspended: z.literal(false) }),
]);
export type UserSuspensionInput = z.infer<typeof UserSuspensionInput>;
