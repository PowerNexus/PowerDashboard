import { NODE_HEARTBEAT_LOST_MS } from "@gamedashboard/contracts";
import { type Database, nodes, servers } from "@gamedashboard/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { battre } from "../../common/background-tick";
import { DATABASE } from "../../common/database.provider";
import { WebhookEmitterService } from "../webhooks/webhook-emitter.service";

/**
 * Cadence du balayage.
 *
 * Trente secondes pour un seuil de deux minutes : assez fin pour que l'alerte
 * parte dans la foulée, assez large pour que la requête — deux lectures
 * indexées qui ne rendent rien la plupart du temps — reste sans effet.
 */
const TICK_MS = 30_000;

/**
 * Veilleur de la santé des nodes.
 *
 * Il existe parce qu'un état dérivé ne se remarque pas tout seul : `nodeStatus`
 * conclut « injoignable » chaque fois qu'on l'interroge, mais personne
 * n'interroge quand personne ne regarde l'écran. Un node peut donc tomber la
 * nuit et n'être découvert qu'au matin, par le client dont le serveur ne
 * répond plus.
 *
 * Ce service est le seul écrivain de `nodes.unreachable_since`, et cette
 * colonne ne stocke pas la santé du node — elle stocke ce qui a déjà été
 * annoncé. La distinction est ce qui permet de n'émettre qu'aux transitions :
 * un rappel quand ça tombe, un quand ça revient, et rien entre les deux.
 *
 * Le seuil est celui du contrat (`NODE_HEARTBEAT_LOST_MS`), le même que celui
 * dont se servent les écrans. La garantie qui en découle vaut d'être dite : si
 * l'administration affiche « injoignable », le rappel est parti.
 */
@Injectable()
export class NodeHealthWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NodeHealthWatcherService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WebhookEmitterService) private readonly webhooks: WebhookEmitterService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => battre(this.logger, "node-health-watcher", () => this.tick()),
      TICK_MS,
    );
    // Ce minuteur ne doit pas empêcher le processus de s'arrêter.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Un tour : ce qui vient de tomber, puis ce qui vient de revenir.
   *
   * Dans cet ordre, mais l'ordre n'a pas d'importance — les deux ensembles
   * sont disjoints par construction, un node ne pouvant pas à la fois dépasser
   * le seuil et être rentré dans les temps.
   */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.reportLost(now);
      await this.reportRecovered(now);
    } catch (error) {
      this.logger.error(`Veille des nodes : ${message(error)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Nodes qui viennent de dépasser le seuil sans avoir encore été signalés.
   *
   * Un node **jamais joint** est écarté : `last_heartbeat_at` nul signifie
   * qu'il vient d'être déclaré et que son daemon n'a pas encore été installé.
   * Annoncer une panne à ce moment-là inonderait le système tiers pendant
   * exactement la phase où l'on met la machine en service — et il n'y a rien à
   * signaler, puisqu'on n'a rien perdu.
   */
  private async reportLost(now: Date): Promise<void> {
    const threshold = new Date(now.getTime() - NODE_HEARTBEAT_LOST_MS).toISOString();

    const lost = await this.db
      .select({
        id: nodes.id,
        name: nodes.name,
        fqdn: nodes.fqdn,
        ownerId: nodes.ownerId,
        maintenance: nodes.maintenanceMode,
        lastHeartbeatAt: nodes.lastHeartbeatAt,
      })
      .from(nodes)
      .where(
        and(
          isNotNull(nodes.lastHeartbeatAt),
          lt(nodes.lastHeartbeatAt, threshold),
          // Déjà annoncé : on ne répète pas.
          isNull(nodes.unreachableSince),
        ),
      );

    for (const node of lost) {
      /**
       * La marque est posée **avant** d'émettre.
       *
       * Si l'émission échoue, le node reste marqué et l'alerte est perdue ;
       * dans l'ordre inverse, un plantage entre l'émission et la marque ferait
       * repartir le même rappel toutes les trente secondes. Entre une alerte
       * manquée et une alerte en boucle, la seconde est pire : elle noie les
       * autres.
       *
       * On inscrit le **dernier heartbeat**, pas l'heure du constat : la panne
       * a commencé quand le node s'est tu, pas quand on s'en est aperçu. La
       * durée rendue au retour serait sinon systématiquement amputée du seuil
       * et du délai de balayage.
       */
      await this.db
        .update(nodes)
        .set({ unreachableSince: node.lastHeartbeatAt })
        .where(eq(nodes.id, node.id));

      const affected = await this.affectedServers(node.id);

      this.logger.warn(`Node « ${node.name} » injoignable (${affected} serveur(s) concernés).`);

      await this.webhooks.emit("node.unreachable", {
        nodeId: node.id,
        name: node.name,
        fqdn: node.fqdn,
        // Le revendeur exploitant, ou `null` pour la plateforme : c'est lui
        // qu'il faut prévenir, et le tiers ne peut pas le deviner.
        ownerId: node.ownerId,
        lastHeartbeatAt: node.lastHeartbeatAt,
        /**
         * Le node était-il en maintenance déclarée ?
         *
         * L'alerte part dans les deux cas — le fait l'emporte sur l'intention,
         * comme dans `nodeStatus`, et les serveurs sont réellement coupés. Mais
         * sans ce drapeau, un redémarrage prévu à trois heures du matin est
         * indiscernable d'une panne, et le receveur ne peut que réveiller
         * quelqu'un ou ignorer les deux.
         */
        maintenance: node.maintenance,
        // Le nombre de serveurs coupés dit l'ampleur. Sans lui, « un node est
        // tombé » ne permet pas de décider s'il faut réveiller quelqu'un.
        affectedServers: affected,
      });
    }
  }

  /** Nodes marqués injoignables dont le daemon a reparlé depuis. */
  private async reportRecovered(now: Date): Promise<void> {
    const threshold = new Date(now.getTime() - NODE_HEARTBEAT_LOST_MS).toISOString();

    const back = await this.db
      .select({
        id: nodes.id,
        name: nodes.name,
        fqdn: nodes.fqdn,
        ownerId: nodes.ownerId,
        unreachableSince: nodes.unreachableSince,
      })
      .from(nodes)
      .where(
        and(
          isNotNull(nodes.unreachableSince),
          isNotNull(nodes.lastHeartbeatAt),
          sql`${nodes.lastHeartbeatAt} >= ${threshold}`,
        ),
      );

    for (const node of back) {
      await this.db.update(nodes).set({ unreachableSince: null }).where(eq(nodes.id, node.id));

      this.logger.log(`Node « ${node.name} » de nouveau joignable.`);

      await this.webhooks.emit("node.recovered", {
        nodeId: node.id,
        name: node.name,
        fqdn: node.fqdn,
        ownerId: node.ownerId,
        // La durée close l'incident : c'est ce qu'on reporte dans un rapport,
        // et la recalculer côté tiers supposerait qu'il ait gardé la date.
        unreachableSince: node.unreachableSince,
        outageSeconds:
          node.unreachableSince === null
            ? null
            : Math.round((now.getTime() - new Date(node.unreachableSince).getTime()) / 1000),
      });
    }
  }

  private async affectedServers(nodeId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(servers)
      .where(eq(servers.nodeId, nodeId));
    return row?.n ?? 0;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
