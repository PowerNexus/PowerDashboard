import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ActivityService } from "../activity/activity.service";
import type { PlatformSettingsService } from "../admin/platform-settings.service";
import type { AuthenticatedRequest } from "../auth/session.guard";
import type { EngineService } from "../marketplace/engine.service";
import type { EulaService } from "../marketplace/eula.service";
import type { MarketplaceService } from "../marketplace/marketplace.service";
import type { WingsClientService } from "../wings/wings-client.service";
import type { AllocationsService } from "./allocations.service";
import type { BackupsService } from "./backups.service";
import type { DatabasesService } from "./databases.service";
import type { SchedulesService } from "./schedules.service";
import type { ServerAccessService } from "./server-access.service";
import { ServerFeaturesController } from "./server-features.controller";
import type { ServerInvitesService } from "./server-invites.service";
import type { ServerSettingsService } from "./server-settings.service";
import type { ServerWebhooksService } from "./server-webhooks.service";
import type { SubusersService } from "./subusers.service";

/**
 * Exécuter ou réactiver une planification exige le droit de faire ses tâches.
 *
 * Le contrôle existait à la création et à la modification seulement : un
 * sous-utilisateur `schedules.update` sans `power.stop` arrêtait le serveur
 * par `POST schedules/:id/run`, avec le jeton du panel. La tâche s'exécute
 * sous les droits du panel, pas sous ceux de qui la déclenche.
 */

const SERVEUR = "srv-1";
const TACHE = "sch-1";
const requete = {
  user: { id: "u-1" },
  scopes: null,
  ip: "127.0.0.1",
} as unknown as AuthenticatedRequest & { ip?: string };

/** Un invité qui peut modifier les planifications, et rien d'autre. */
function monter() {
  const access = {
    require: vi.fn(async (_p: unknown, _id: string, permission: string) => {
      if (permission.startsWith("schedules.")) return { isOwner: false };
      throw new ForbiddenException(`Permission « ${permission} » requise.`);
    }),
  };
  const schedules = {
    tasksOf: vi.fn(async () => [
      { action: "command", payload: "say Redémarrage dans une minute" },
      { action: "power", payload: "stop" },
    ]),
    runNow: vi.fn(async () => {}),
    setActive: vi.fn(async () => {}),
  };
  const activity = { record: vi.fn(async () => {}), labelFor: vi.fn(async () => "Matheo") };
  const controleur = new ServerFeaturesController(
    access as unknown as ServerAccessService,
    {} as ServerWebhooksService,
    {} as BackupsService,
    {} as DatabasesService,
    {} as AllocationsService,
    {} as SubusersService,
    {} as ServerInvitesService,
    schedules as unknown as SchedulesService,
    {} as ServerSettingsService,
    activity as unknown as ActivityService,
    {} as WingsClientService,
    {} as MarketplaceService,
    {} as EngineService,
    {} as EulaService,
    {} as PlatformSettingsService,
  );
  return { controleur, access, schedules, activity };
}

describe("POST schedules/:scheduleId/run", () => {
  it("refuse de lancer une tâche dont l'invité ne pourrait pas faire les étapes", async () => {
    const { controleur, schedules, activity } = monter();

    await expect(controleur.runSchedule(requete, SERVEUR, TACHE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(schedules.tasksOf).toHaveBeenCalledWith(SERVEUR, TACHE);
    expect(schedules.runNow).not.toHaveBeenCalled();
    expect(activity.record).not.toHaveBeenCalled();
  });

  it("lance la tâche quand chaque étape est permise", async () => {
    const { controleur, access, schedules } = monter();
    access.require.mockImplementation(async () => ({ isOwner: false }));

    await controleur.runSchedule(requete, SERVEUR, TACHE);
    expect(access.require).toHaveBeenCalledWith(expect.anything(), SERVEUR, "console.send");
    expect(access.require).toHaveBeenCalledWith(expect.anything(), SERVEUR, "power.stop");
    expect(schedules.runNow).toHaveBeenCalledWith(SERVEUR, TACHE);
  });
});

describe("POST schedules/:scheduleId/active", () => {
  it("refuse de réactiver une tâche dont l'invité ne pourrait pas faire les étapes", async () => {
    const { controleur, schedules } = monter();

    await expect(
      controleur.setScheduleActive(requete, SERVEUR, TACHE, { active: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(schedules.setActive).not.toHaveBeenCalled();
  });

  it("laisse la mettre en pause : une pause n'exécute rien", async () => {
    // Exiger ici les droits des étapes n'arrêterait personne — le même invité
    // peut déjà vider la tâche de ses étapes par une modification — et
    // empêcherait seulement d'arrêter une tâche qui dérange.
    const { controleur, schedules } = monter();

    await controleur.setScheduleActive(requete, SERVEUR, TACHE, { active: false });
    expect(schedules.tasksOf).not.toHaveBeenCalled();
    expect(schedules.setActive).toHaveBeenCalledWith(SERVEUR, TACHE, false);
  });
});
