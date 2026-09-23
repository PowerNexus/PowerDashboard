import type { Logger } from "@nestjs/common";

/**
 * Lance un balayage de fond **sans pouvoir abattre le processus**.
 *
 * Tous les services périodiques du panel s'armaient ainsi :
 *
 * ```ts
 * setInterval(() => void this.tick(), TICK_MS);
 * ```
 *
 * `void` écarte l'avertissement du compilateur sur une promesse ignorée, et
 * rien d'autre : il **n'attrape pas** le rejet. Un balayage qui échoue produit
 * donc un rejet non traité, et Node 24 termine le processus par défaut. Le
 * panel entier — sessions, console, API applicative — tombait ainsi sur une
 * panne de base survenue dans une tâche de fond, souvent la moins importante
 * des dix.
 *
 * Observé en conditions réelles : un mot de passe PostgreSQL devenu invalide
 * a fait mourir l'API depuis la file des rappels sortants. Les requêtes en
 * cours n'avaient rien à voir avec elle.
 *
 * Ici, l'échec est consigné et la vie continue : le tour suivant retentera, et
 * si la panne dure, le journal en porte une ligne par tour plutôt qu'un
 * processus mort et aucune trace de ce qui l'a tué.
 */
export function battre(logger: Logger, label: string, tick: () => Promise<void>): Promise<void> {
  /*
   * La promesse rendue **ne rejette jamais** : elle ne sert qu'à qui veut
   * savoir que la tâche est finie — un test, un arrêt propre. Les appelants
   * habituels l'ignorent sans risque.
   */
  return tick().catch((error: unknown) => {
    logger.error(`${label} : ${error instanceof Error ? error.message : "erreur inconnue"}`);
  });
}
