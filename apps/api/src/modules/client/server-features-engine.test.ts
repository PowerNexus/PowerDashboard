import { BadRequestException } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it, vi } from "vitest";
import type { ActivityService } from "../activity/activity.service";
import type { PlatformSettingsService } from "../admin/platform-settings.service";
import type { AuthenticatedRequest } from "../auth/session.guard";
import type { EngineService, EngineStartOptions } from "../marketplace/engine.service";
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
 * Changement de moteur avec sauvegarde préalable : une sauvegarde ordinaire,
 * sous sa propre permission, attendue avant la première écriture. Lancé en
 * tâche de fond : la requête rend l'état « en cours », le journal suit l'issue.
 */

const requete = {
  user: { id: "u-1" },
  scopes: null,
  ip: "127.0.0.1",
} as unknown as AuthenticatedRequest & { ip?: string };

function monter() {
  const access = {
    require: vi.fn(async () => ({ isOwner: true })),
    requireOperable: vi.fn(async () => {}),
  };
  const backups = {
    create: vi.fn(async () => ({ id: "sauv-1", name: "Avant changement de moteur" })),
    awaitCompletion: vi.fn(async () => {}),
  };
  const settled: Promise<void>[] = [];
  let issue: "succes" | "echec" = "succes";
  const engine = {
    start: vi.fn(async (_id: string, o: string, v: string, options: EngineStartOptions) => {
      // Comme le service : la suite se déroule après la réponse.
      settled.push(
        (async () => {
          await options.beforeWrite?.();
          await options.onSettled?.(
            issue === "succes"
              ? {
                  result: {
                    label: "Pack",
                    files: 3,
                    eulaReset: true,
                    missing: [],
                    kept: ["config/a.toml"],
                    removed: 1,
                    notice: null,
                  },
                }
              : { error: "La sauvegarde préalable a échoué : rien n'a été modifié." },
          );
        })(),
      );
      return {
        status: "running" as const,
        optionId: o,
        versionId: v,
        label: "Pack v2",
        startedAt: "2026-09-25T10:00:00.000Z",
        finishedAt: null,
        report: null,
        error: null,
      };
    }),
  };
  const activity = { record: vi.fn(async () => {}), labelFor: vi.fn(async () => "Matheo") };
  const controleur = new ServerFeaturesController(
    access as unknown as ServerAccessService,
    {} as ServerWebhooksService,
    backups as unknown as BackupsService,
    {} as DatabasesService,
    {} as AllocationsService,
    {} as SubusersService,
    {} as ServerInvitesService,
    {} as SchedulesService,
    {} as ServerSettingsService,
    activity as unknown as ActivityService,
    {} as WingsClientService,
    {} as MarketplaceService,
    engine as unknown as EngineService,
    {} as EulaService,
    {} as PlatformSettingsService,
  );
  const fin = () => Promise.all(settled);
  const echouer = () => {
    issue = "echec";
  };
  return { controleur, access, backups, engine, activity, fin, echouer };
}

describe("POST engine/install", () => {
  it("sauvegarde d'abord quand on le demande, et attend qu'elle soit close", async () => {
    const { controleur, access, backups, engine, fin } = monter();

    await controleur.installEngine(requete, "srv-1", {
      optionId: "modpack:pack",
      versionId: "v2",
      backupFirst: true,
    });
    await fin();

    expect(access.require).toHaveBeenCalledWith(expect.anything(), "srv-1", "backups.create");
    expect(backups.create).toHaveBeenCalledWith("srv-1", "Avant changement de moteur", []);
    expect(backups.awaitCompletion).toHaveBeenCalledWith("srv-1", "sauv-1", expect.any(Number));
    expect(engine.start).toHaveBeenCalledWith(
      "srv-1",
      "modpack:pack",
      "v2",
      expect.objectContaining({ installedBy: "u-1" }),
    );
  });

  it("rend aussitôt l'installation en cours, et journalise son issue une fois close", async () => {
    const { controleur, activity, fin } = monter();

    const reponse = await controleur.installEngine(requete, "srv-1", {
      optionId: "modpack:pack",
      versionId: "v2",
    });
    // Régression : la requête attendait la fin de l'installation, et
    // l'interface abandonnait au bout de dix secondes sans compte rendu.
    expect(reponse.data).toMatchObject({ status: "running", label: "Pack v2" });
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, ServerFeaturesController.prototype.installEngine),
    ).toBe(202);

    await fin();
    const evenements = activity.record.mock.calls.map(
      (call) => (call as unknown as [{ event: string }])[0].event,
    );
    expect(evenements).toEqual(["engine.install", "server.eula_reset"]);
  });

  it("un échec en tâche de fond est journalisé avec sa raison", async () => {
    const { controleur, activity, fin, echouer } = monter();
    echouer();

    await controleur.installEngine(requete, "srv-1", { optionId: "modpack:pack", versionId: "v2" });
    await fin();

    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "engine.install_failed",
        properties: expect.objectContaining({ error: expect.stringMatching(/sauvegarde/) }),
      }),
    );
  });

  it("sans demande, aucune sauvegarde n'est faite en douce", async () => {
    const { controleur, access, backups, fin } = monter();

    await controleur.installEngine(requete, "srv-1", { optionId: "modpack:pack", versionId: "v2" });
    await fin();

    expect(backups.create).not.toHaveBeenCalled();
    expect(access.require).not.toHaveBeenCalledWith(expect.anything(), "srv-1", "backups.create");
  });

  it("refuse un choix de sauvegarde qui n'est pas un booléen", async () => {
    const { controleur } = monter();
    await expect(
      controleur.installEngine(requete, "srv-1", {
        optionId: "modpack:pack",
        versionId: "v2",
        backupFirst: "oui",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
