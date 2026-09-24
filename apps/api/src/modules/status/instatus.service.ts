import {
  INSTATUS_SILENT,
  type InstatusSummary,
  instatusSummaryUrl,
  parseInstatusSummary,
} from "@gamedashboard/contracts";
import { type Database, settings } from "@gamedashboard/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { inArray } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { assertPublicDestination } from "../../common/public-url";

/**
 * Reprise des annonces publiées sur la page Instatus.
 *
 * Le panel sait d'expérience ce que ses machines font — un heartbeat le lui
 * dit. Il ne sait pas ce qu'on a **décidé** : une migration prévue samedi, une
 * fenêtre de maintenance chez l'hébergeur. Cela se rédige ailleurs, et c'est
 * précisément ce que cette lecture rapatrie.
 *
 * Elle n'ajoute rien à l'état des machines et ne le corrige pas : la page de
 * statut du panel continue de dire ce qu'elle observe. Ici, on relaie ce
 * qu'Instatus annonce, en le nommant comme tel.
 */

/**
 * Durée pendant laquelle le résumé est réemployé.
 *
 * La bannière est rendue sur **chaque page** du panel : sans cache, chaque
 * navigation d'un client déclencherait un appel sortant vers Instatus. Une
 * minute est assez courte pour qu'une annonce apparaisse pendant qu'on regarde,
 * et assez longue pour que cent clients connectés ne fassent pas cent appels.
 */
const CACHE_TTL_MS = 60_000;

/** Au-delà, on renonce : une page de statut lente ne doit pas retenir le panel. */
const FETCH_TIMEOUT_MS = 4_000;

@Injectable()
export class InstatusService {
  private readonly logger = new Logger(InstatusService.name);
  private cached: { at: number; summary: InstatusSummary } | null = null;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Ce qu'Instatus annonce en ce moment.
   *
   * Ne lève jamais et ne rend jamais d'erreur : une page de statut injoignable
   * ne doit pas empêcher un client d'ouvrir son serveur. Elle se traduit par un
   * état `unknown`, qui n'affiche rien — et surtout pas « tout va bien », qui
   * serait une affirmation qu'on n'a pas vérifiée.
   */
  async summary(): Promise<InstatusSummary> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < CACHE_TTL_MS) return this.cached.summary;

    const summary = await this.read();
    this.cached = { at: now, summary };
    return summary;
  }

  private async read(): Promise<InstatusSummary> {
    const rows = await this.db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(inArray(settings.key, ["instatus.pageUrl", "instatus.showBanner"]));

    const stored = new Map(rows.map((row) => [row.key, row.value]));

    // Absent vaut affiché : le réglage a `true` pour repli, et une bannière
    // qu'on a pris la peine de configurer doit apparaître sans second geste.
    if (stored.get("instatus.showBanner") === false) return INSTATUS_SILENT;

    const pageUrl = stored.get("instatus.pageUrl");
    if (typeof pageUrl !== "string" || pageUrl.trim() === "") return INSTATUS_SILENT;

    const url = instatusSummaryUrl(pageUrl);
    if (!url) {
      this.logger.warn(`Adresse Instatus inexploitable (https attendu) : « ${pageUrl} ».`);
      return INSTATUS_SILENT;
    }

    try {
      /*
       * Destination publique, jugée **à chaque lecture** et pas seulement à
       * l'enregistrement : le nom peut résoudre ailleurs depuis, et une valeur
       * enregistrée avant ce contrôle n'y est jamais passée. Le panel publie
       * ce qu'il lit ici dans la bannière de chaque page ; une adresse interne
       * en ferait une fenêtre sur son propre réseau (rapport ASVS, NC-56).
       */
      await assertPublicDestination(new URL(url));
    } catch (error) {
      this.logger.warn(
        `Page Instatus refusée : ${error instanceof Error ? error.message : "destination invalide"}`,
      );
      return INSTATUS_SILENT;
    }

    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Instatus a répondu ${response.status} sur ${url}.`);
        return INSTATUS_SILENT;
      }
      return parseInstatusSummary(await response.json());
    } catch (error) {
      /*
       * Silence, et une trace.
       *
       * Une bannière absente est un défaut d'information ; une page de panel
       * qui échoue parce qu'un service tiers ne répond pas est une panne. Le
       * second coûte infiniment plus cher que le premier.
       */
      this.logger.warn(
        `Page Instatus injoignable : ${error instanceof Error ? error.message : "cause inconnue"}.`,
      );
      return INSTATUS_SILENT;
    }
  }
}
