import type { Database, schedules, scheduleTasks } from "@gamedashboard/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityService } from "../activity/activity.service";
import type { BackupsService } from "../client/backups.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { WingsClientService } from "../wings/wings-client.service";
import { ScheduleRunnerService } from "./schedule-runner.service";

type Schedule = typeof schedules.$inferSelect;
type Task = typeof scheduleTasks.$inferSelect;

const OWNER = "11111111-1111-1111-1111-111111111111";

/**
 * Une planification qui redémarre, avec l'attente qu'on lui prête.
 *
 * L'attente est ce qui compte dans ce fichier : c'est elle qui, exécutée en
 * file, immobilisait la plateforme entière.
 */
function planification(rang: number, attenteSecondes: number): { row: Schedule; tasks: Task[] } {
  const id = `sched-${rang}`;
  return {
    row: {
      id,
      serverId: `srv-${rang}`,
      name: `Redémarrage ${rang}`,
      cronMinute: "0",
      cronHour: "4",
      cronDayOfMonth: "*",
      cronMonth: "*",
      cronDayOfWeek: "*",
      isActive: true,
      onlyWhenOnline: false,
      nextRunAt: new Date(Date.now() - 1000).toISOString(),
      lastRunAt: null,
      lastRunFailure: null,
      failureNotifiedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as Schedule,
    tasks: [
      {
        id: `task-${rang}`,
        scheduleId: id,
        sequence: 1,
        action: "power",
        payload: "restart",
        timeOffset: attenteSecondes,
        continueOnFailure: false,
      } as unknown as Task,
    ],
  };
}

interface Ecriture {
  readonly valeurs: Record<string, unknown>;
}

/**
 * Le strict nécessaire de Drizzle, reconnu par ce qui est demandé.
 *
 * Les `select` se distinguent par leurs colonnes — aucun compteur d'appels,
 * qui se décalerait au premier tour supplémentaire.
 */
function decor(lots: { row: Schedule; tasks: Task[] }[][], etat: string | null = "running") {
  const ecritures: Ecriture[] = [];
  const taches = new Map<string, Task[]>();
  for (const lot of lots) for (const p of lot) taches.set(p.row.id, p.tasks);
  const files = [...lots];

  const db = {
    update: () => ({
      set: (valeurs: Record<string, unknown>) => ({
        where: () => {
          ecritures.push({ valeurs });
          // Attendable **et** porteur de `.returning()` : Drizzle rend un
          // objet qui se comporte comme les deux, et le service emprunte
          // l'une ou l'autre voie selon l'écriture.
          const promesse = Promise.resolve([]) as unknown as Promise<unknown[]> & {
            returning: (champs?: unknown) => Promise<unknown[]>;
          };
          promesse.returning = (champs?: unknown) => {
            // `returning({ id })` : c'est le verrou d'avertissement, pas la
            // prise d'échéances. Il doit rendre une ligne pour que l'envoi
            // parte une fois.
            if (champs) return Promise.resolve([{ id: "verrou" }]);
            return Promise.resolve((files.shift() ?? []).map((p) => p.row));
          };
          return promesse;
        },
      }),
    }),
    select: (champs?: Record<string, unknown>) => ({
      from: () => {
        if (!champs) {
          // Les étapes d'une planification.
          return {
            where: (condition: unknown) => ({
              orderBy: async () => taches.get(idDe(condition)) ?? [],
            }),
          };
        }
        if ("state" in champs) {
          return { where: () => ({ limit: async () => [{ state: etat }] }) };
        }
        return { where: () => ({ limit: async () => [{ name: "Banc", ownerId: OWNER }] }) };
      },
    }),
  } as unknown as Database;

  const power = vi.fn(async () => {});
  const service = new ScheduleRunnerService(
    db,
    { power, sendCommand: vi.fn(), resources: vi.fn() } as unknown as WingsClientService,
    { notify: vi.fn(async () => {}) } as unknown as NotificationsService,
    { record: vi.fn(async () => {}) } as unknown as ActivityService,
    { create: vi.fn(async () => {}) } as unknown as BackupsService,
  );
  return { service, power, ecritures };
}

/**
 * L'identifiant cherché dans une condition Drizzle.
 *
 * Le décor n'exécute pas de SQL : il lit la valeur liée par `eq(scheduleId, …)`
 * pour rendre les bonnes étapes. Sans cela, les trois planifications du banc de
 * parallélisme partageraient les mêmes — et le banc passerait pour une raison
 * qui n'est pas celle qu'il énonce.
 */
function idDe(condition: unknown): string {
  const vus = new Set<unknown>();
  const pile: unknown[] = [condition];
  while (pile.length > 0) {
    const noeud = pile.pop();
    if (typeof noeud === "string") {
      if (/^sched-\d+$/.test(noeud)) return noeud;
      continue;
    }
    if (noeud === null || typeof noeud !== "object" || vus.has(noeud)) continue;
    vus.add(noeud);
    pile.push(...Object.values(noeud as Record<string, unknown>));
  }
  return "";
}

describe("ScheduleRunnerService", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("n'attend pas une planification pour en commencer une autre", async () => {
    // Trois séquences de dix minutes. En file, la dernière partirait à la
    // trentième minute : c'est ce qui décalait les sauvegardes nocturnes de
    // tous les autres clients.
    const lot = [planification(1, 600), planification(2, 600), planification(3, 600)];
    const { service, power } = decor([lot]);

    const tour = service.tick();
    await vi.advanceTimersByTimeAsync(600_000 + 50);

    expect(power).toHaveBeenCalledTimes(3);
    await tour;
  });

  it("repousse l'échéance provisoire au-delà de l'attente de la séquence", async () => {
    // Sans quoi une seconde instance du panel verrait la ligne échue pendant
    // qu'elle attend, et redémarrerait le serveur une seconde fois.
    const debut = Date.now();
    const { service, ecritures } = decor([[planification(1, 900)]]);

    const tour = service.tick();
    await vi.advanceTimersByTimeAsync(10);

    const reservations = ecritures
      .map((e) => e.valeurs.nextRunAt)
      .filter((valeur): valeur is string => typeof valeur === "string");
    expect(reservations.length).toBeGreaterThan(0);
    const derniere = Date.parse(reservations[reservations.length - 1] as string);
    expect(derniere - debut).toBeGreaterThan(900_000);

    await vi.advanceTimersByTimeAsync(900_000 + 50);
    await tour;
  });

  it("reporte sans consommer l'échéance quand le serveur s'installe", async () => {
    const { service, power, ecritures } = decor([[planification(1, 0)]], "installing");

    await service.tick();

    expect(power).not.toHaveBeenCalled();
    // Une seule écriture : la réservation posée par la prise. Replanifier ici
    // sauterait l'occurrence, alors que l'installation finit en quelques
    // minutes et que la tâche doit encore partir.
    expect(ecritures).toHaveLength(1);
    expect(ecritures[0]?.valeurs.lastRunAt).toBeUndefined();
  });

  it("saute l'occurrence quand le serveur est suspendu", async () => {
    // Rien ne se terminera tout seul : attendre reviendrait à reprendre la
    // ligne à chaque balayage jusqu'à la levée de la suspension.
    const { service, power, ecritures } = decor([[planification(1, 0)]], "suspended");

    await service.tick();

    expect(power).not.toHaveBeenCalled();
    expect(ecritures.some((e) => typeof e.valeurs.nextRunAt === "string")).toBe(true);
    expect(ecritures.every((e) => e.valeurs.lastRunAt === undefined)).toBe(true);
  });
});
