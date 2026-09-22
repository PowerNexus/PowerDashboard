import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Colonnes présentes sur toutes les tables (§6 du plan).
 *
 * Les horodatages sont en `timestamptz` : une table stocke un instant, jamais
 * une heure locale. Le fuseau d'affichage appartient à l'utilisateur et se
 * choisit au rendu ; l'inscrire en base rendrait tout calcul de durée faux dès
 * qu'un node vit sur un autre continent.
 */
export const id = () => uuid("id").primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`);

/**
 * `updated_at` n'est pas mis à jour par un trigger : la mise à jour est portée
 * par la requête, donc visible dans le code qui la provoque. Un trigger
 * silencieux rend l'historique difficile à relire lorsqu'on cherche qui a
 * modifié quoi.
 */
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().default(sql`now()`);

export const timestamps = {
  createdAt: createdAt(),
  updatedAt: updatedAt(),
};

/** Instant optionnel : « jamais survenu » se dit `null`, pas epoch. */
export const moment = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });
