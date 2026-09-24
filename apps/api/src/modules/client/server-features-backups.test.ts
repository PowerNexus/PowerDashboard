import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ActivityService } from "../activity/activity.service";
import type { PlatformSettingsService } from "../admin/platform-settings.service";
import type { AuthenticatedRequest } from "../auth/session.guard";
import type { EngineService } from "../marketplace/engine.service";
import type { EulaService } from "../marketplace/eula.service";
import type { MarketplaceService } from "../marketplace/marketplace.service";
import { type WingsClientService, WingsUnavailableError } from "../wings/wings-client.service";
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
 * Restauration : un refus du daemon se lit, une panne reste une panne.
 *
 * Le défaut corrigé : tout refus de Wings sortait ici en 503 « le node n'a
 * pas répondu ». Une restauration depuis le compartiment se refuse pourtant
 * pour des raisons que le daemon écrit — et que personne ne lisait.
 */

const requete = {
  user: { id: "u-1" },
  scopes: null,
  ip: "127.0.0.1",
} as unknown as AuthenticatedRequest & { ip?: string };

function monter(echec: Error) {
  const access = {
    require: vi.fn(async () => ({ isOwner: true })),
    requireOperable: vi.fn(async () => {}),
  };
  const backups = {
    restore: vi.fn(async () => {
      throw echec;
    }),
  };
  const activity = { record: vi.fn(async () => {}), labelFor: vi.fn(async () => "Matheo") };
  return new ServerFeaturesController(
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
    {} as EngineService,
    {} as EulaService,
    {} as PlatformSettingsService,
  );
}

describe("POST backups/:backupId/restore", () => {
  it("rend le refus du daemon tel quel, en 400", async () => {
    const refus =
      'The provided backup link is not a supported content type. "binary/octet-stream" is not application/x-gzip.';
    const controleur = monter(new WingsUnavailableError("N1", "HTTP 400", 400, refus));

    const appel = controleur.restoreBackup(requete, "srv-1", "sauv-1", {});
    await expect(appel).rejects.toBeInstanceOf(BadRequestException);
    await expect(appel).rejects.toThrow(refus);
  });

  it("garde le 503 pour un node qui ne répond pas", async () => {
    const controleur = monter(new WingsUnavailableError("N1", "délai dépassé"));

    await expect(controleur.restoreBackup(requete, "srv-1", "sauv-1", {})).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
