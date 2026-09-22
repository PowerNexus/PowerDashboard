import { NODE_HEARTBEAT_LOST_MS } from "@gamedashboard/contracts";
import { type Database, nodes, serverMetrics, servers } from "@gamedashboard/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { battre } from "../../common/background-tick";
import { DATABASE } from "../../common/database.provider";
import { WingsClientService } from "../wings/wings-client.service";

/**
 * Relevé de la consommation des serveurs.
 *
 * `server_metrics` existait depuis le premier schéma sans que rien n'y écrive :
 * la table était déclarée, la colonne `mem_bytes` documentée, et le panel ne
 * mesurait rien. Tout ce qui repose sur la consommation réelle — l'enveloppe
 * d'un revendeur, sa part sur une machine partagée, les graphes d'un serveur —
 * n'avait donc aucune source.
 *
 * Ce service est cette source, et la seule.
 *
 * Il interroge **Wings**, qui est le seul à savoir ce qu'un conteneur
 * consomme : le panel n'a aucun accès aux machines. Un node qui ne répond pas
 * ne produit simplement pas de ligne — l'absence de mesure reste une absence,
 * elle n'est jamais remplacée par un zéro ni par une estimation.
 */

/**
 * Cadence du relevé.
 *
 * Une minute : assez fin pour qu'une enveloppe dépassée se voie dans la minute,
 * assez large pour qu'un parc de cent serveurs ne fasse pas cent appels toutes
 * les dix secondes. C'est aussi la granularité qu'on attend d'un graphe de
 * consommation : en deçà, on mesure le bruit.
 */
const TICK_MS = 60_000;

/**
 * Nombre de serveurs interrogés en parallèle.
 *
 * Wings traite chaque requête dans sa propre goroutine, mais le panel a un
 * pool de connexions et un seul processus : lancer deux cents appels d'un coup
 * ferait expirer les derniers avant d'avoir servi les premiers.
 */
const CONCURRENCY = 8;

@Injectable()
export class MetricsCollectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsCollectorService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WingsClientService) private readonly wings: WingsClientService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => battre(this.logger, "metrics-collector", () => this.tick()),
      TICK_MS,
    );
    // Ce minuteur ne doit pas empêcher le processus de s'arrêter.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Un tour de relevé.
   *
   * Seuls les serveurs des nodes qui **répondent encore** sont interrogés. Sur
   * un node tombé, chaque appel attendrait son échéance : cent serveurs sur une
   * machine muette feraient un tour de plusieurs minutes, et le tour suivant
   * commencerait avant la fin du précédent.
   *
   * Le `running` est un verrou de pauvre, et il suffit : ce service n'a qu'une
   * instance par processus, et deux tours simultanés n'écriraient de toute
   * façon que des lignes horodatées différemment.
   */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const alive = new Date(now.getTime() - NODE_HEARTBEAT_LOST_MS).toISOString();

      const targets = await this.db
        .select({ id: servers.id, nodeName: nodes.name })
        .from(servers)
        .innerJoin(nodes, eq(servers.nodeId, nodes.id))
        .where(
          and(
            isNotNull(nodes.lastHeartbeatAt),
            gt(nodes.lastHeartbeatAt, alive),
            /*
             * Ni suspendu, ni en cours d'installation.
             *
             * `servers.state` est l'état de **gestion** décidé par le panel, pas
             * celui du conteneur : « suspendu » et « en installation » veulent
             * dire qu'il n'y a rien à mesurer. Les interroger ferait un appel
             * par minute et par serveur pour une réponse connue d'avance.
             */
            sql`${servers.state} is null or ${servers.state} not in ('suspended', 'installing', 'install_failed')`,
          ),
        );

      if (targets.length === 0) return;

      let written = 0;
      let failed = 0;

      for (let start = 0; start < targets.length; start += CONCURRENCY) {
        const batch = targets.slice(start, start + CONCURRENCY);
        const results = await Promise.all(
          batch.map(async (target) => {
            try {
              await this.sample(target.id, now);
              return true;
            } catch (error) {
              /*
               * Un serveur muet n'interrompt pas le tour.
               *
               * Un conteneur en cours d'installation, un serveur que Wings ne
               * connaît pas encore, un délai dépassé : autant de cas normaux.
               * Ce qui compte est qu'aucune ligne ne soit écrite — la mesure
               * manque, et c'est tout ce qu'on peut en dire.
               */
              this.logger.debug(
                `Relevé impossible pour ${target.id} sur « ${target.nodeName} » : ${
                  error instanceof Error ? error.message : "cause inconnue"
                }`,
              );
              return false;
            }
          }),
        );

        written += results.filter(Boolean).length;
        failed += results.filter((ok) => !ok).length;
      }

      if (failed > 0) {
        this.logger.warn(`Relevé : ${written} serveur(s) mesuré(s), ${failed} sans réponse.`);
      }
    } catch (error) {
      // Une panne de base ne doit pas tuer le minuteur : le tour suivant
      // réessaiera, et le service reste debout.
      this.logger.error(
        `Tour de relevé interrompu : ${error instanceof Error ? error.message : "cause inconnue"}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * Un relevé, écrit tel que Wings le rapporte.
   *
   * Les octets ne sont pas convertis ici : la table les stocke en octets, et
   * c'est aux lecteurs de choisir leur unité. Convertir à l'écriture ferait
   * perdre de la précision une fois pour toutes, sans que personne l'ait
   * demandé.
   *
   * `players` reste nul : Wings ne connaît pas les joueurs, c'est une sonde par
   * jeu qui les compte (§8.2). Écrire zéro dirait « aucun joueur » là où il
   * faut lire « pas mesuré ».
   */
  private async sample(serverId: string, now: Date): Promise<void> {
    const resources = await this.wings.resources(serverId);
    const utilization = resources.utilization;

    await this.db.insert(serverMetrics).values({
      serverId,
      at: now.toISOString(),
      state: resources.state,
      cpuPct: utilization.cpu_absolute,
      memBytes: utilization.memory_bytes,
      diskBytes: utilization.disk_bytes,
      netRx: utilization.network.rx_bytes,
      netTx: utilization.network.tx_bytes,
      players: null,
    });

    /*
     * L'état du conteneur n'est **pas** recopié sur `servers.state`.
     *
     * Le schéma le dit : cette colonne porte l'état de gestion — installation,
     * suspension, restauration — et l'état du conteneur vient de Wings sans
     * être dupliqué (§8.2). Y écrire « running » écraserait « suspended » à la
     * minute suivante, et un serveur suspendu redeviendrait exploitable pour
     * tout ce qui lit cette colonne.
     *
     * L'état rapporté est conservé dans la ligne de mesure, où il date de la
     * mesure et ne prétend rien de plus.
     */
  }
}
