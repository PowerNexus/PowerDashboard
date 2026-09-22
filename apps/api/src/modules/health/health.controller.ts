import type { Database } from "@gamedashboard/db";
import { Controller, Get, Inject } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/** Au-delà, la base ne répond pas assez vite pour servir une page. */
const DATABASE_TIMEOUT_MS = 2_000;

export interface HealthReport {
  /** `ok` quand tout répond, `degraded` quand l'API vit mais qu'une dépendance manque. */
  status: "ok" | "degraded";
  database: boolean;
  /** Millisecondes écoulées depuis le démarrage du processus. */
  uptimeSeconds: number;
}

/**
 * Point de santé de l'API.
 *
 * Sans garde et sans authentification, à dessein : on le consulte précisément
 * quand plus rien ne marche, et une vérification de session exigerait une base
 * de données — c'est-à-dire la chose même dont on cherche à savoir si elle
 * répond.
 *
 * Ce qu'il rend est volontairement pauvre : un état, un booléen, une durée.
 * Pas de version, pas d'URL de base, pas de message d'erreur — cette route est
 * lisible par n'importe qui, et le détail d'une panne est une information
 * d'exploitation. Le panel, lui, n'a besoin que de savoir quoi afficher.
 *
 * La distinction qu'il permet est tout l'intérêt : « l'API ne répond pas » et
 * « l'API répond mais sa base est tombée » appellent deux gestes différents, et
 * un écran qui les confond envoie chercher le problème au mauvais endroit.
 */
@Controller("api/health")
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async health(): Promise<HealthReport> {
    const database = await this.pingDatabase();

    return {
      status: database ? "ok" : "degraded",
      database,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  /**
   * Une requête triviale, avec une échéance.
   *
   * Sans délai maximal, une base saturée ferait attendre le point de santé
   * aussi longtemps qu'elle fait attendre les pages — et un contrôle de santé
   * qui ne répond pas ne renseigne personne. Au-delà de deux secondes, la
   * réponse est « non » : c'est la vérité utile.
   */
  private async pingDatabase(): Promise<boolean> {
    try {
      await Promise.race([
        this.db.execute(sql`select 1`),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("délai dépassé")), DATABASE_TIMEOUT_MS),
        ),
      ]);
      return true;
    } catch {
      return false;
    }
  }
}
