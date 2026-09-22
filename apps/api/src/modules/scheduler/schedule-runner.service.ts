import { type CronFields, nextCronRun, scheduleVerdict } from "@gamedashboard/contracts";
import { type Database, schedules, scheduleTasks, servers } from "@gamedashboard/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { and, asc, eq, isNotNull, isNull, lte, notInArray, sql } from "drizzle-orm";
import { battre } from "../../common/background-tick";
import { DATABASE } from "../../common/database.provider";
import { ActivityService } from "../activity/activity.service";
import { BackupsService } from "../client/backups.service";
import { NotificationsService } from "../notifications/notifications.service";
import { WingsClientService } from "../wings/wings-client.service";

/**
 * Cadence du balayage.
 *
 * Trente secondes pour une résolution cron d'une minute : un intervalle égal à
 * la minute risquerait de manquer une échéance par simple dérive d'horloge,
 * alors qu'un balayage deux fois plus fréquent ne coûte qu'une requête indexée.
 */
const TICK_MS = 30_000;

/** Attente maximale entre deux étapes, en secondes. Même plafond qu'à la saisie. */
const MAX_TASK_OFFSET_SECONDS = 900;

/**
 * Combien de planifications avancent en même temps.
 *
 * Elles étaient exécutées en file, attentes comprises. Une séquence courante —
 * « prévenir les joueurs, attendre dix minutes, redémarrer » — suspendait donc
 * *toute la plateforme* pendant dix minutes : les sauvegardes nocturnes des
 * autres clients partaient avec ce retard, sans que rien ne le signale.
 *
 * Six à la fois, parce que chacune est essentiellement une attente : le travail
 * réel est fait par le daemon, et ce qui coûte ici est la connexion ouverte.
 */
const MAX_PARALLELES = 6;

/**
 * Exécution des tâches planifiées.
 *
 * Sans ce service, une tâche planifiée serait une ligne en base que rien ne
 * déclenche — c'est-à-dire une promesse faite à l'écran et jamais tenue.
 *
 * Il vit dans l'API plutôt que dans un processus séparé, pour l'instant : un
 * démon distinct n'apporterait rien tant qu'il n'y a qu'une instance, et
 * l'attribution des échéances est déjà écrite pour supporter plusieurs
 * lecteurs (voir `claimDue`).
 */
@Injectable()
export class ScheduleRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduleRunnerService.name);
  private timer: NodeJS.Timeout | null = null;
  private claiming = false;
  /**
   * Les planifications déjà en vol dans ce processus.
   *
   * Depuis qu'elles avancent en parallèle, le balayage suivant tombe pendant
   * qu'une séquence longue attend encore. La réservation posée par `claimDue`
   * finirait par expirer et la ligne serait reprise — deux redémarrages, ou
   * deux sauvegardes comptées au quota. Cet ensemble les écarte de la prise.
   */
  private readonly enVol = new Set<string>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WingsClientService) private readonly wings: WingsClientService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(ActivityService) private readonly activity: ActivityService,
    @Inject(BackupsService) private readonly backups: BackupsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => battre(this.logger, "schedule-runner", () => this.tick()),
      TICK_MS,
    );
    // `unref` : ce minuteur ne doit pas empêcher le processus de s'arrêter.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Un tour de balayage.
   *
   * **La prise** est sérialisée : deux prises simultanées dans le même
   * processus liraient le même lot. **Les exécutions** ne le sont pas — elles
   * partent ensemble, jusqu'à `MAX_PARALLELES`, et le tour rend la main sans
   * les attendre. Une séquence de quinze minutes ne retarde donc plus que
   * elle-même.
   *
   * `tick` reste attendable pour les tests et pour un arrêt propre : la
   * promesse rendue couvre l'ensemble du lot.
   */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.claiming) return;
    let due: (typeof schedules.$inferSelect)[];
    try {
      this.claiming = true;
      due = await this.claimDue(now);
    } finally {
      this.claiming = false;
    }

    // Marqué **avant** la moindre attente : le tour suivant peut tomber entre
    // deux `await`, et c'est cet ensemble, pas la réservation en base, qui
    // l'empêche de reprendre la même ligne.
    for (const schedule of due) this.enVol.add(schedule.id);

    const file = [...due];
    const ouvriers = Array.from({ length: Math.min(MAX_PARALLELES, file.length) }, async () => {
      for (let schedule = file.shift(); schedule; schedule = file.shift()) {
        try {
          await this.execute(schedule);
        } catch (error) {
          this.logger.error(`Tâche « ${schedule.name} » : ${message(error)}`);
        } finally {
          this.enVol.delete(schedule.id);
        }
      }
    });
    await Promise.all(ouvriers);
  }

  /**
   * Prend les tâches échues **en les replanifiant dans le même ordre**.
   *
   * L'échéance suivante est écrite par l'UPDATE qui sélectionne : une lecture
   * suivie d'une écriture laisserait deux instances du panel prendre la même
   * tâche et l'exécuter deux fois — deux redémarrages, ou deux sauvegardes
   * comptées dans le quota.
   *
   * La nouvelle échéance est calculée en SQL à partir de l'ancienne ? Non : le
   * calcul cron vit en TypeScript. On pose donc une échéance provisoire dans le
   * futur immédiat pour verrouiller la ligne, puis on écrit la vraie après
   * exécution. Une instance concurrente voit alors une échéance déjà dépassée
   * de son point de vue, mais la clause `lte` ne la reprend pas.
   */
  private async claimDue(now: Date) {
    const reserved = new Date(now.getTime() + TICK_MS * 4).toISOString();

    return this.db
      .update(schedules)
      .set({ nextRunAt: reserved })
      .where(
        and(
          eq(schedules.isActive, true),
          isNotNull(schedules.nextRunAt),
          lte(schedules.nextRunAt, now.toISOString()),
          // Celles qui attendent encore une de leurs étapes ne sont pas à
          // reprendre, même si leur réservation est dépassée.
          ...(this.enVol.size > 0 ? [notInArray(schedules.id, [...this.enVol])] : []),
        ),
      )
      .returning();
  }

  private async execute(schedule: typeof schedules.$inferSelect): Promise<void> {
    const tasks = await this.db
      .select()
      .from(scheduleTasks)
      .where(eq(scheduleTasks.scheduleId, schedule.id))
      .orderBy(asc(scheduleTasks.sequence));

    /*
     * Un serveur bloqué n'exécute rien, et c'est au panel de le dire.
     *
     * Le contrôle est ici plutôt que dans chaque étape : `power` et `command`
     * partent chez le daemon, qui les refuse lui-même, mais `backup` passe par
     * le panel et n'avait personne devant lui.
     */
    const verdict = scheduleVerdict(await this.etatGere(schedule.serverId));
    if (verdict === "postpone") {
      /*
       * Rien à écrire : `claimDue` a déjà posé une échéance dans quelques
       * minutes pour réserver la ligne. Ne pas la remplacer par la prochaine
       * occurrence cron **est** le report — le balayage suivant la reprendra,
       * et l'installation aura fini d'ici là.
       */
      this.logger.debug(`Tâche « ${schedule.name} » reportée : le serveur est occupé.`);
      return;
    }
    if (verdict === "skip") {
      this.logger.log(`Tâche « ${schedule.name} » ignorée : serveur suspendu ou hors service.`);
      await this.reschedule(schedule, { ran: false });
      return;
    }

    if (await this.shouldSkip(schedule)) {
      this.logger.log(`Tâche « ${schedule.name} » ignorée : serveur hors ligne.`);
      await this.reschedule(schedule, { ran: false });
      return;
    }

    /*
     * La réservation est allongée à la mesure de la séquence.
     *
     * `claimDue` ne connaît pas encore les étapes au moment où il réserve : il
     * pose deux minutes, ce qui suffit à une séquence ordinaire mais pas à
     * celles qui attendent. Maintenant que les attentes sont connues — et que
     * l'on sait qu'on va bien exécuter — on repousse l'échéance provisoire
     * au-delà, sans quoi une seconde instance du panel verrait la ligne échue
     * pendant l'attente et redémarrerait le serveur une seconde fois.
     */
    const attente = tasks.reduce((total, task) => total + borner(task.timeOffset), 0);
    if (attente * 1000 > TICK_MS * 2) {
      await this.db
        .update(schedules)
        .set({ nextRunAt: new Date(Date.now() + attente * 1000 + TICK_MS * 4).toISOString() })
        .where(eq(schedules.id, schedule.id));
    }

    let echec: string | null = null;

    for (const task of tasks) {
      // Borné ici aussi : une ligne ancienne, ou écrite par un autre chemin,
      // ne doit pas pouvoir immobiliser une place d'exécution pendant des
      // heures. La borne d'entrée est celle du contrôleur.
      const offset = borner(task.timeOffset);
      if (offset > 0) await wait(offset * 1000);
      try {
        await this.runTask(schedule.serverId, task);
      } catch (error) {
        this.logger.error(`Étape ${task.sequence} de « ${schedule.name} » : ${message(error)}`);
        // La première cause est retenue, pas la dernière : c'est elle qui
        // explique la séquence, les suivantes n'en étant que les conséquences.
        echec ??= `Étape ${task.sequence} (${task.action}) : ${message(error)}`;
        // L'arrêt par défaut est délibéré : une séquence « prévenir les
        // joueurs, puis redémarrer » ne doit pas redémarrer si l'avertissement
        // n'est pas passé.
        if (!task.continueOnFailure) break;
      }
    }

    await this.reschedule(schedule, { ran: true, failure: echec });
  }

  private async runTask(serverId: string, task: typeof scheduleTasks.$inferSelect): Promise<void> {
    switch (task.action) {
      case "command":
        await this.wings.sendCommand(serverId, task.payload);
        return;
      case "power":
        await this.wings.power(serverId, task.payload);
        return;
      case "backup":
        /*
         * La même porte que la création manuelle, et non une seconde.
         *
         * Elle insérait ici directement dans `backups`, court-circuitant le
         * contrôle de quota. Le quota ne s'appliquait donc qu'à ceux qui
         * cliquent — alors que c'est précisément la planification qui produit
         * des sauvegardes en masse, et que ce quota est le seul garde-fou
         * contre le remplissage du disque d'un node.
         *
         * Le refus pour quota atteint remonte maintenant comme n'importe quel
         * échec d'étape : il est retenu sur la planification, signalé une fois
         * au propriétaire, et lui dit quoi faire — supprimer une sauvegarde.
         */
        await this.backups.create(
          serverId,
          task.payload.trim() || `Sauvegarde planifiée du ${today()}`,
          [],
        );
        return;
      default:
        // Déclaré plutôt que silencieusement ignoré : une étape qui ne fait
        // rien sans le dire est pire qu'une étape en erreur.
        throw new Error(`Action « ${task.action} » non prise en charge par le planificateur.`);
    }
  }

  /**
   * L'état de gestion du serveur, tel que le panel le tient.
   *
   * Celui du conteneur ne dirait rien d'utile ici : pendant une installation
   * comme sous suspension, le conteneur est simplement à l'arrêt.
   */
  private async etatGere(serverId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ state: servers.state })
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);
    // Un serveur disparu ne bloque pas : l'étape échouera d'elle-même, en
    // nommant la vraie cause plutôt qu'un blocage inventé.
    return row?.state ?? null;
  }

  /**
   * Vrai quand la tâche demande un serveur en marche et qu'il ne l'est pas.
   *
   * Un node injoignable compte comme « hors ligne » : le contraire ferait
   * envoyer des commandes dans le vide et marquerait la tâche comme exécutée.
   */
  private async shouldSkip(schedule: typeof schedules.$inferSelect): Promise<boolean> {
    if (!schedule.onlyWhenOnline) return false;
    try {
      const resources = await this.wings.resources(schedule.serverId);
      return resources.state !== "running";
    } catch {
      return true;
    }
  }

  private async reschedule(
    schedule: typeof schedules.$inferSelect,
    outcome: { ran: boolean; failure?: string | null },
  ): Promise<void> {
    const cron: CronFields = {
      minute: schedule.cronMinute,
      hour: schedule.cronHour,
      dayOfMonth: schedule.cronDayOfMonth,
      month: schedule.cronMonth,
      dayOfWeek: schedule.cronDayOfWeek,
    };

    let nextRunAt: string | null = null;
    try {
      nextRunAt = nextCronRun(cron)?.toISOString() ?? null;
    } catch (error) {
      // Une expression devenue invalide — modifiée en base à la main — arrête
      // la tâche au lieu de faire échouer le balayage entier à chaque tour.
      this.logger.error(`Tâche « ${schedule.name} » désactivée : ${message(error)}`);
      await this.db
        .update(schedules)
        .set({ isActive: false, nextRunAt: null })
        .where(eq(schedules.id, schedule.id));
      return;
    }

    /*
     * L'issue n'est écrite que par une exécution réelle.
     *
     * Une tâche sautée parce que le serveur dormait ne dit rien de sa santé :
     * effacer l'échec précédent ferait disparaître un dérangement toujours
     * présent, l'inscrire comme échec accuserait une tâche qui n'a rien tenté.
     */
    const issue = outcome.ran
      ? {
          lastRunAt: sql`now()`,
          lastRunFailure: outcome.failure ?? null,
          // Le drapeau d'avertissement se réarme au premier succès : un
          // dérangement réparé puis revenu doit se signaler de nouveau.
          ...(outcome.failure ? {} : { failureNotifiedAt: null }),
        }
      : {};

    await this.db
      .update(schedules)
      .set({ nextRunAt, ...issue, updatedAt: new Date().toISOString() })
      .where(eq(schedules.id, schedule.id));

    if (outcome.ran && outcome.failure) {
      await this.signalerEchec(schedule, outcome.failure);
    }
  }

  /**
   * Prévient le propriétaire qu'une planification ne fonctionne plus.
   *
   * **Une fois par dérangement**, pas une fois par tour : une tâche horaire
   * cassée enverrait vingt-quatre messages par jour, et celui qui les reçoit
   * finirait par couper ses notifications — c'est-à-dire par cesser de recevoir
   * celle qui comptera.
   *
   * L'avertissement compte plus que la tâche elle-même : quelqu'un qui croit
   * avoir des sauvegardes quotidiennes ne découvre le contraire qu'au moment
   * où il en a besoin.
   */
  private async signalerEchec(
    schedule: typeof schedules.$inferSelect,
    cause: string,
  ): Promise<void> {
    // La pose du drapeau **est** le verrou : la condition `is null` dans la
    // requête écarte un second envoi, y compris depuis une autre instance du
    // panel qui balaierait au même moment.
    const [arme] = await this.db
      .update(schedules)
      .set({ failureNotifiedAt: sql`now()` })
      .where(and(eq(schedules.id, schedule.id), isNull(schedules.failureNotifiedAt)))
      .returning({ id: schedules.id });
    if (!arme) return;

    const [serveur] = await this.db
      .select({ name: servers.name, ownerId: servers.ownerId })
      .from(servers)
      .where(eq(servers.id, schedule.serverId))
      .limit(1);
    if (!serveur) return;

    await this.notifications
      .notify({
        userId: serveur.ownerId,
        type: "schedule.failed",
        level: "warning",
        title: `La tâche « ${schedule.name} » a échoué`,
        body:
          `Sur le serveur « ${serveur.name} » : ${cause}. ` +
          "Les exécutions suivantes seront tentées ; ce message ne se répétera pas tant que le dérangement dure.",
        serverId: schedule.serverId,
      })
      // Un envoi impossible ne doit pas empêcher la replanification, déjà
      // écrite plus haut. Le drapeau reste posé : mieux vaut un avertissement
      // manqué qu'une tâche qui cesse de tourner parce que SMTP est tombé.
      .catch((error) => this.logger.error(`Avertissement non transmis : ${message(error)}`));

    await this.activity
      .record({
        event: "schedule.failed",
        serverId: schedule.serverId,
        actorId: null,
        actorType: "system",
        actorLabel: "Planificateur",
        ip: null,
        userAgent: null,
        properties: { schedule: schedule.name, cause },
      })
      .catch(() => undefined);
  }
}

/** L'attente d'une étape, ramenée dans l'intervalle admis. */
function borner(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(Math.max(0, offset), MAX_TASK_OFFSET_SECONDS);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "erreur inconnue";
}
