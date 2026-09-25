import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ActivityService } from "../activity/activity.service";
import type { PlatformSettingsService } from "../admin/platform-settings.service";
import type { AuthenticatedRequest } from "../auth/session.guard";
import type { EngineInstallOptions, EngineService } from "../marketplace/engine.service";
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
 * sous sa propre permission, attendue avant la première écriture.
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
  const engine = {
    install: vi.fn(async (_id: string, _o: string, _v: string, options: EngineInstallOptions) => {
      await options.beforeWrite?.();
      return {
        label: "Pack",
        files: 3,
        eulaReset: false,
        missing: [],
        kept: ["config/a.toml"],
        removed: 1,
        notice: null,
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
  return { controleur, access, backups, engine };
}

describe("POST engine/install", () => {
  it("sauvegarde d'abord quand on le demande, et attend qu'elle soit close", async () => {
    const { controleur, access, backups, engine } = monter();

    await controleur.installEngine(requete, "srv-1", {
      optionId: "modpack:pack",
      versionId: "v2",
      backupFirst: true,
    });

    expect(access.require).toHaveBeenCalledWith(expect.anything(), "srv-1", "backups.create");
    expect(backups.create).toHaveBeenCalledWith("srv-1", "Avant changement de moteur", []);
    expect(backups.awaitCompletion).toHaveBeenCalledWith("srv-1", "sauv-1", expect.any(Number));
    expect(engine.install).toHaveBeenCalledWith(
      "srv-1",
      "modpack:pack",
      "v2",
      expect.objectContaining({ installedBy: "u-1" }),
    );
  });

  it("sans demande, aucune sauvegarde n'est faite en douce", async () => {
    const { controleur, access, backups } = monter();

    await controleur.installEngine(requete, "srv-1", { optionId: "modpack:pack", versionId: "v2" });

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
