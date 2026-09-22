import {
  type HostbillService as BilledService,
  HOSTBILL_DUE_SOON_DAYS,
} from "@gamedashboard/contracts";
import { type Database, notifications, users } from "@gamedashboard/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { and, eq, gt, sql } from "drizzle-orm";
import { battre } from "../../common/background-tick";
import { DATABASE } from "../../common/database.provider";
import { HostbillService } from "../client/hostbill.service";
import { NotificationsService } from "../notifications/notifications.service";

/**
 * La facturation qui prévient, au lieu d'attendre qu'on regarde.
 *
 * Le panel lit déjà HostBill : l'écran d'accueil montre les échéances de qui
 * s'y rend. C'est exactement le problème — une échéance ne se voit que si l'on
 * vient la voir, et personne n'ouvre son panel la veille d'un impayé. Un
 * service suspendu pour non-paiement se découvre alors par un serveur éteint,
 * ce qui est la plus mauvaise façon de l'apprendre.
 *
 * Cette veille porte l'information là où l'on regarde : la cloche. Elle
 * n'écrit rien chez le facturier — le panel lit, il ne facture pas — et ne
 * décide de rien : elle rapporte, et renvoie vers l'espace client, seul endroit
 * où l'on peut payer.
 */

/**
 * Cadence.
 *
 * Une heure : une échéance se compte en jours, et interroger un facturier tiers
 * toutes les minutes pour une donnée qui bouge une fois par mois reviendrait à
 * le marteler pour rien.
 */
const TICK_MS = 3_600_000;

/**
 * Délai avant de redire la même chose.
 *
 * Vingt heures, soit moins d'un jour : la même échéance reproduit une cloche le
 * lendemain, ce qui est utile quand elle approche, mais jamais deux fois dans
 * la journée. Sans ce garde-fou, la veille horaire déposerait vingt-quatre
 * notifications identiques par service et par jour, et la cloche deviendrait
 * un endroit qu'on n'ouvre plus.
 */
const REPEAT_AFTER = "20 hours";

/** Comptes interrogés de front. Chacun coûte deux appels au facturier. */
const CONCURRENCY = 4;

@Injectable()
export class BillingWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingWatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(HostbillService) private readonly hostbill: HostbillService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => battre(this.logger, "billing-watcher", () => this.tick()),
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
      /*
       * Seuls les comptes qui ont quelque chose à facturer.
       *
       * Chaque compte coûte deux appels au facturier : interroger la totalité
       * de la base, comptes d'administration compris, reviendrait à le marteler
       * pour des adresses qu'il ne connaît pas. Deux indices suffisent à les
       * reconnaître — un rattachement explicite, posé par le SSO ou l'API, ou
       * la possession d'au moins un serveur.
       */
      const accounts = await this.db
        .select({ id: users.id })
        .from(users)
        .where(
          sql`${users.externalId} is not null
              or exists (select 1 from servers s where s.owner_id = ${users.id})`,
        );

      for (let start = 0; start < accounts.length; start += CONCURRENCY) {
        await Promise.all(
          accounts.slice(start, start + CONCURRENCY).map((account) => this.watch(account.id)),
        );
      }
    } catch (error) {
      this.logger.error(`Veille de facturation interrompue : ${describe(error)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Un compte.
   *
   * L'injoignabilité du facturier ne produit **aucune** cloche : « nous n'avons
   * pas pu demander » n'est pas une information pour un client, et transformer
   * une panne de notre côté en alerte de son côté ferait payer notre incident
   * par son inquiétude.
   */
  private async watch(userId: string): Promise<void> {
    const summary = await this.hostbill.summaryFor(userId);
    if (!summary.configured || summary.unreachable) return;

    for (const service of summary.services) {
      const alert = alertFor(service);
      if (!alert) continue;

      if (await this.alreadySaid(userId, alert.type, service.id)) continue;

      await this.notifications.notify({
        userId,
        type: alert.type,
        title: alert.title,
        body: alert.body,
        level: alert.level,
        // Le service est noté pour que le tour suivant sache qu'on l'a déjà dit.
        context: { serviceId: service.id },
        // L'adresse de l'espace client vient du réglage de la plateforme : le
        // panel ne sait pas bâtir les URL du facturier, et n'a pas à les
        // deviner. Sans réglage, la notification reste — elle informe — mais
        // elle ne conduit nulle part, ce qui est honnête.
        ...(summary.clientUrl ? { href: summary.clientUrl } : {}),
      });
    }
  }

  /**
   * A-t-on déjà dit cela récemment ?
   *
   * La question porte sur le couple **type et service**, pas sur le type seul :
   * deux services qui arrivent à échéance le même jour méritent deux cloches,
   * et n'en déposer qu'une en cacherait une.
   */
  private async alreadySaid(userId: string, type: string, serviceId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.type, type),
          sql`${notifications.data}->>'serviceId' = ${serviceId}`,
          gt(notifications.createdAt, sql`now() - ${REPEAT_AFTER}::interval`),
        ),
      )
      .limit(1);

    return row !== undefined;
  }
}

interface BillingAlert {
  type: string;
  title: string;
  body: string;
  level: "info" | "warning" | "danger";
}

/**
 * Ce qu'il y a à dire d'un service, ou rien.
 *
 * Trois cas seulement, et chacun appelle un geste différent :
 *
 * - **suspendu** : le serveur est déjà arrêté, il faut payer pour le reprendre ;
 * - **en retard** : il ne va pas tarder à l'être ;
 * - **bientôt dû** : rien n'est cassé, c'est un rappel.
 *
 * Un service actif dont l'échéance est lointaine ne produit rien. Une cloche
 * qui se déclenche pour dire que tout va bien apprend à ne plus regarder les
 * cloches.
 */
export function alertFor(service: BilledService): BillingAlert | null {
  if (service.state === "suspended") {
    return {
      type: "billing.suspended",
      title: `Service suspendu : ${service.name}`,
      body: "Ce service est suspendu chez le facturier. Le régler depuis l'espace client le rétablira.",
      level: "danger",
    };
  }

  if (service.daysLeft === null) return null;

  if (service.daysLeft < 0) {
    const days = Math.abs(service.daysLeft);
    return {
      type: "billing.overdue",
      title: `Échéance dépassée : ${service.name}`,
      body: `Le terme est passé depuis ${days} jour${days > 1 ? "s" : ""}. Un service impayé finit par être suspendu.`,
      level: "danger",
    };
  }

  if (service.daysLeft <= HOSTBILL_DUE_SOON_DAYS) {
    return {
      type: "billing.due_soon",
      title: `Échéance proche : ${service.name}`,
      body:
        service.daysLeft === 0
          ? "Le terme tombe aujourd'hui."
          : `Le terme tombe dans ${service.daysLeft} jour${service.daysLeft > 1 ? "s" : ""}.`,
      level: "warning",
    };
  }

  return null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
