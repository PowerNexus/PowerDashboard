import { type CronFields, CronSyntaxError, nextCronRun } from "@gamedashboard/contracts";
import { type Database, schedules, scheduleTasks } from "@gamedashboard/db";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/** Actions que le planificateur sait réellement exécuter. */
export const SUPPORTED_ACTIONS = ["command", "power", "backup"] as const;
export type SupportedAction = (typeof SUPPORTED_ACTIONS)[number];

export interface ScheduleTaskInput {
  action: SupportedAction;
  payload: string;
  timeOffset: number;
  continueOnFailure: boolean;
}

export interface ClientScheduleTask extends ScheduleTaskInput {
  id: string;
  sequence: number;
}

export interface ClientSchedule {
  id: string;
  name: string;
  cron: CronFields;
  isActive: boolean;
  onlyWhenOnline: boolean;
  lastRunAt: string | null;
  /**
   * Cause de l'échec de la dernière exécution, `null` si elle a réussi.
   *
   * Rendue au client, et non gardée pour l'exploitant : la plupart des causes
   * le concernent directement — une commande qui n'existe pas, un quota de
   * sauvegardes atteint — et sont réparables par lui seul.
   */
  lastRunFailure: string | null;
  /** `null` quand l'expression ne survient jamais, ou que la tâche est en pause. */
  nextRunAt: string | null;
  tasks: ClientScheduleTask[];
}

@Injectable()
export class SchedulesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(serverId: string): Promise<ClientSchedule[]> {
    const rows = await this.db
      .select()
      .from(schedules)
      .where(eq(schedules.serverId, serverId))
      .orderBy(asc(schedules.name));

    const tasks = await this.db.select().from(scheduleTasks).orderBy(asc(scheduleTasks.sequence));

    return rows.map((row) =>
      project(
        row,
        tasks.filter((t) => t.scheduleId === row.id),
      ),
    );
  }

  async create(
    serverId: string,
    name: string,
    cron: CronFields,
    options: { onlyWhenOnline: boolean; isActive: boolean },
    tasks: ScheduleTaskInput[],
  ): Promise<ClientSchedule> {
    const nextRunAt = this.computeNext(cron, options.isActive);

    const [row] = await this.db
      .insert(schedules)
      .values({
        serverId,
        name: name.trim(),
        cronMinute: cron.minute,
        cronHour: cron.hour,
        cronDayOfMonth: cron.dayOfMonth,
        cronMonth: cron.month,
        cronDayOfWeek: cron.dayOfWeek,
        isActive: options.isActive,
        onlyWhenOnline: options.onlyWhenOnline,
        nextRunAt,
      })
      .returning();

    if (!row) throw new BadRequestException("Tâche non enregistrée.");
    return project(row, await this.replaceTasks(row.id, tasks));
  }

  async update(
    serverId: string,
    scheduleId: string,
    name: string,
    cron: CronFields,
    options: { onlyWhenOnline: boolean; isActive: boolean },
    tasks: ScheduleTaskInput[],
  ): Promise<ClientSchedule> {
    await this.mustFind(serverId, scheduleId);
    const nextRunAt = this.computeNext(cron, options.isActive);

    const [row] = await this.db
      .update(schedules)
      .set({
        name: name.trim(),
        cronMinute: cron.minute,
        cronHour: cron.hour,
        cronDayOfMonth: cron.dayOfMonth,
        cronMonth: cron.month,
        cronDayOfWeek: cron.dayOfWeek,
        isActive: options.isActive,
        onlyWhenOnline: options.onlyWhenOnline,
        nextRunAt,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schedules.id, scheduleId))
      .returning();

    if (!row) throw new NotFoundException("Tâche introuvable.");
    return project(row, await this.replaceTasks(scheduleId, tasks));
  }

  /**
   * Met en pause ou relance.
   *
   * Relancer recalcule l'échéance à partir de maintenant, et ne rattrape pas
   * les occurrences manquées pendant la pause : une tâche remise en service à
   * midi après trois jours d'arrêt lancerait sinon trois sauvegardes d'affilée.
   */
  async setActive(serverId: string, scheduleId: string, isActive: boolean): Promise<void> {
    const existing = await this.mustFind(serverId, scheduleId);
    await this.db
      .update(schedules)
      .set({
        isActive,
        nextRunAt: this.computeNext(cronOf(existing), isActive),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schedules.id, scheduleId));
  }

  /**
   * Les étapes d'une tâche **de ce serveur**, dans l'ordre.
   *
   * Pour que le contrôleur exige le droit de faire chacune avant de lancer ou
   * de réactiver la tâche : c'est le jeton du panel qui les exécutera, pas les
   * droits de qui appuie sur le bouton.
   */
  async tasksOf(
    serverId: string,
    scheduleId: string,
  ): Promise<{ action: SupportedAction; payload: string }[]> {
    await this.mustFind(serverId, scheduleId);
    const rows = await this.db
      .select({ action: scheduleTasks.action, payload: scheduleTasks.payload })
      .from(scheduleTasks)
      .where(eq(scheduleTasks.scheduleId, scheduleId))
      .orderBy(asc(scheduleTasks.sequence));
    return rows.map((row) => ({ action: row.action as SupportedAction, payload: row.payload }));
  }

  /** Avance l'échéance à maintenant : c'est le planificateur qui exécutera. */
  async runNow(serverId: string, scheduleId: string): Promise<void> {
    await this.mustFind(serverId, scheduleId);
    // Passer par l'échéance plutôt que d'exécuter ici garantit qu'une exécution
    // manuelle emprunte exactement le même chemin qu'une exécution planifiée —
    // sans quoi l'une des deux finirait par diverger et par n'être jamais testée.
    await this.db
      .update(schedules)
      .set({ nextRunAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(schedules.id, scheduleId));
  }

  async remove(serverId: string, scheduleId: string): Promise<void> {
    await this.mustFind(serverId, scheduleId);
    await this.db.delete(schedules).where(eq(schedules.id, scheduleId));
  }

  /**
   * Remplace les étapes.
   *
   * Effacer puis réinsérer plutôt que réconcilier : la séquence porte une
   * contrainte d'unicité, et une mise à jour en place la violerait dès qu'on
   * intervertit deux étapes.
   */
  private async replaceTasks(scheduleId: string, tasks: ScheduleTaskInput[]) {
    await this.db.delete(scheduleTasks).where(eq(scheduleTasks.scheduleId, scheduleId));
    if (tasks.length === 0) return [];

    return this.db
      .insert(scheduleTasks)
      .values(
        tasks.map((task, index) => ({
          scheduleId,
          sequence: index,
          action: task.action,
          payload: task.payload,
          timeOffset: Math.max(0, Math.trunc(task.timeOffset)),
          continueOnFailure: task.continueOnFailure,
        })),
      )
      .returning();
  }

  /**
   * Prochaine échéance, ou `null`.
   *
   * `null` dans deux cas distincts mais de même conséquence : la tâche est en
   * pause, ou son expression ne survient jamais. Le planificateur balaye par
   * échéance — une valeur nulle le fait simplement passer à côté, ce qui est
   * exactement le comportement voulu dans les deux cas.
   */
  private computeNext(cron: CronFields, isActive: boolean): string | null {
    if (!isActive) return null;
    try {
      return nextCronRun(cron)?.toISOString() ?? null;
    } catch (error) {
      if (error instanceof CronSyntaxError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  private async mustFind(serverId: string, scheduleId: string) {
    const [row] = await this.db
      .select()
      .from(schedules)
      .where(and(eq(schedules.id, scheduleId), eq(schedules.serverId, serverId)))
      .limit(1);

    if (!row) throw new NotFoundException("Tâche introuvable.");
    return row;
  }
}

function cronOf(row: typeof schedules.$inferSelect): CronFields {
  return {
    minute: row.cronMinute,
    hour: row.cronHour,
    dayOfMonth: row.cronDayOfMonth,
    month: row.cronMonth,
    dayOfWeek: row.cronDayOfWeek,
  };
}

function project(
  row: typeof schedules.$inferSelect,
  tasks: (typeof scheduleTasks.$inferSelect)[],
): ClientSchedule {
  return {
    id: row.id,
    name: row.name,
    cron: cronOf(row),
    isActive: row.isActive,
    onlyWhenOnline: row.onlyWhenOnline,
    lastRunAt: row.lastRunAt,
    lastRunFailure: row.lastRunFailure,
    nextRunAt: row.nextRunAt,
    tasks: tasks.map((task) => ({
      id: task.id,
      sequence: task.sequence,
      action: task.action as SupportedAction,
      payload: task.payload,
      timeOffset: task.timeOffset,
      continueOnFailure: task.continueOnFailure,
    })),
  };
}
