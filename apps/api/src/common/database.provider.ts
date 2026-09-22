import { createClient, type Database } from "@gamedashboard/db";
import type { Provider } from "@nestjs/common";

/**
 * Jeton d'injection de la base.
 *
 * Un symbole plutôt qu'une chaîne : deux modules ne peuvent pas définir par
 * mégarde le même identifiant, et l'erreur en cas d'oubli nomme précisément ce
 * qui manque.
 */
export const DATABASE = Symbol("DATABASE");

export const databaseProvider: Provider = {
  provide: DATABASE,
  useFactory: (): Database => createClient(),
};
