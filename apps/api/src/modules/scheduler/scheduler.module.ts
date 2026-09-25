import { Module } from "@nestjs/common";
import { databaseProvider } from "../../common/database.provider";
import { ActivityModule } from "../activity/activity.module";
import { BillingModule } from "../billing/billing.module";
import { ClientModule } from "../client/client.module";
import { MarketplaceModule } from "../marketplace/marketplace.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { ResellerModule } from "../reseller/reseller.module";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { WingsModule } from "../wings/wings.module";
import { BillingWatcherService } from "./billing-watcher.service";
import { GameProbeService } from "./game-probe.service";
import { MarketplaceUpdateWatcherService } from "./marketplace-update-watcher.service";
import { MetricsCollectorService } from "./metrics-collector.service";
import { NodeHealthWatcherService } from "./node-health-watcher.service";
import { NodeProbeService } from "./node-probe.service";
import { QuotaEnforcerService } from "./quota-enforcer.service";
import { RetentionService } from "./retention.service";
import { ScheduleRunnerService } from "./schedule-runner.service";

/**
 * Le planificateur.
 *
 * Module à part, et non un service du module client : il n'est appelé par
 * aucune route. Le mêler aux contrôleurs laisserait croire qu'une tâche part
 * parce que quelqu'un a cliqué, alors qu'elle part parce que l'heure est venue.
 *
 * La veille des nodes y vit pour la même raison, et non parce qu'elle
 * ressemble aux tâches planifiées : elle se déclenche au passage du temps, pas
 * à une requête. Un node tombe la nuit, quand personne ne regarde l'écran —
 * c'est précisément le moment où il faut que quelque chose s'en aperçoive.
 */
@Module({
  // `ActivityModule` pour que l'échec d'une tâche laisse une trace dans le
  // journal du serveur : la notification prévient sur le moment, le journal
  // reste pour qui cherche après coup depuis quand cela dure.
  imports: [
    WingsModule,
    WebhooksModule,
    ResellerModule,
    NotificationsModule,
    ActivityModule,
    ClientModule,
    MarketplaceModule,
    // La veille des échéances lit le facturier relié.
    BillingModule,
  ],
  providers: [
    databaseProvider,
    ScheduleRunnerService,
    NodeHealthWatcherService,
    MetricsCollectorService,
    // Le panel demande, au lieu d'attendre : un node sans serveur ne parle
    // jamais de lui-même, et se ferait déclarer injoignable à tort.
    NodeProbeService,
    // Wings sait si un conteneur tourne ; seul le protocole du jeu sait si les
    // joueurs peuvent entrer.
    GameProbeService,
    // Une échéance ne se voit que si on vient la voir : celle-ci vient à nous.
    BillingWatcherService,
    // Une extension prend du retard sans bruit : la veille le remarque.
    MarketplaceUpdateWatcherService,
    // La contrepartie du surprovisionnement : vendre plus qu'on ne détient
    // suppose que quelqu'un rende la mémoire quand elle vient à manquer.
    QuotaEnforcerService,
    // Ce que les autres écrivent sans fin, celui-ci le retire : sans lui, le
    // relevé finit par remplir le disque.
    RetentionService,
  ],
  exports: [
    GameProbeService,
    // Une échéance ne se voit que si on vient la voir : celle-ci vient à nous.
    BillingWatcherService,
    ScheduleRunnerService,
    NodeHealthWatcherService,
    MetricsCollectorService,
    NodeProbeService,
    // La contrepartie du surprovisionnement : vendre plus qu'on ne détient
    // suppose que quelqu'un rende la mémoire quand elle vient à manquer.
    QuotaEnforcerService,
    RetentionService,
  ],
})
export class SchedulerModule {}
