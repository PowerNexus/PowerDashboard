import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { battre } from "../../common/background-tick";
import { MarketplaceService, type UpdateFound } from "../marketplace/marketplace.service";
import { NotificationsService } from "../notifications/notifications.service";

/**
 * La veille des mises à jour du marketplace.
 *
 * L'écran du catalogue ne voyait une mise à jour que si l'extension sortait
 * dans la recherche en cours : un plugin installé il y a six mois, qu'on ne
 * recherche plus, prenait du retard sans que personne le sache. La veille
 * relit chaque installation dans son catalogue, une fois par jour, et range le
 * résultat en base — la liste des extensions installées le montre sans
 * interroger quoi que ce soit.
 *
 * Elle **n'installe rien** : une mise à jour peut casser un serveur, et c'est
 * à son propriétaire de choisir le moment. Elle le prévient, une fois par
 * nouvelle version.
 */

/** Cadence : une heure, pour étaler les appels plutôt que les masser. */
const TICK_MS = 60 * 60_000;

/** Âge au-delà duquel une installation est revérifiée. */
const RECHECK_AFTER = "24 hours";

/**
 * Installations vérifiées par tour. Modrinth tolère 300 requêtes par minute ;
 * rester loin en dessous laisse la place aux recherches des utilisateurs.
 */
const BATCH = 100;

@Injectable()
export class MarketplaceUpdateWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketplaceUpdateWatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(MarketplaceService) private readonly marketplace: MarketplaceService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => battre(this.logger, "marketplace-updates", () => this.tick()),
      TICK_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const found = await this.marketplace.checkUpdates(BATCH, RECHECK_AFTER);
      for (const [serverId, updates] of found) {
        await this.notifications.notifyServerOwner(serverId, {
          type: "marketplace.update_available",
          title: updatesTitle(updates),
          body: updatesBody(updates),
          level: "info",
        });
      }
    } finally {
      this.running = false;
    }
  }
}

export function updatesTitle(updates: UpdateFound[]): string {
  return updates.length === 1
    ? "Une mise à jour d'extension est disponible"
    : `${updates.length} mises à jour d'extensions sont disponibles`;
}

/** Les noms et versions, bornés : une notification n'est pas un inventaire. */
export function updatesBody(updates: UpdateFound[]): string {
  const shown = updates.slice(0, 5).map((u) => `${u.name} ${u.version}`);
  const more = updates.length - shown.length;
  return `${shown.join(", ")}${more > 0 ? ` et ${more} autre(s)` : ""}. À installer depuis la page Extensions du serveur.`;
}
