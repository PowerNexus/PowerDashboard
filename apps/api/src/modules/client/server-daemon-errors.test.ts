import { BadRequestException, Logger, ServiceUnavailableException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityService } from "../activity/activity.service";
import type { PlatformSettingsService } from "../admin/platform-settings.service";
import type { AuthenticatedRequest } from "../auth/session.guard";
import type { EngineService } from "../marketplace/engine.service";
import type { EulaService } from "../marketplace/eula.service";
import type { MarketplaceService } from "../marketplace/marketplace.service";
import {
  DAEMON_UNAVAILABLE_MESSAGE,
  type WingsClientService,
  WingsUnavailableError,
} from "../wings/wings-client.service";
import type { WingsTokenService } from "../wings/wings-token.service";
import type { AllocationsService } from "./allocations.service";
import type { BackupsService } from "./backups.service";
import type { DatabasesService } from "./databases.service";
import type { FileUploadService } from "./file-upload.service";
import type { SchedulesService } from "./schedules.service";
import type { ServerAccessService } from "./server-access.service";
import { ServerFeaturesController } from "./server-features.controller";
import type { ServerInvitesService } from "./server-invites.service";
import { ServerRuntimeController } from "./server-runtime.controller";
import type { ServerSettingsService } from "./server-settings.service";
import type { ServerWebhooksService } from "./server-webhooks.service";
import type { SubusersService } from "./subusers.service";

/**
 * Une panne du daemon, telle que le client la lit.
 *
 * Le message de `WingsUnavailableError` partait tel quel au navigateur : le
 * nom interne du node et la cause brute — `connect ECONNREFUSED
 * 10.0.0.5:8080`, soit l'adresse privée de la machine et son port. Le client
 * doit savoir que la machine ne répond pas ; le reste va au journal du
 * processus, où l'exploitant le cherchera.
 */

const PANNE = new WingsUnavailableError("NODE-PARIS-03", "connect ECONNREFUSED 10.0.0.5:8080");
const requete = {
  user: { id: "u-1" },
  scopes: null,
  ip: "127.0.0.1",
} as unknown as AuthenticatedRequest & { ip?: string };
const access = {
  require: vi.fn(async () => ({ isOwner: true })),
  requireOperable: vi.fn(async () => {}),
};
const activity = { record: vi.fn(async () => {}), labelFor: vi.fn(async () => "Matheo") };

function execution(echec: Error) {
  return new ServerRuntimeController(
    access as unknown as ServerAccessService,
    { listDirectory: vi.fn(async () => Promise.reject(echec)) } as unknown as WingsClientService,
    {} as EulaService,
    {} as WingsTokenService,
    activity as unknown as ActivityService,
    {} as FileUploadService,
  );
}

function fonctions(echec: Error) {
  return new ServerFeaturesController(
    access as unknown as ServerAccessService,
    {} as ServerWebhooksService,
    { restore: vi.fn(async () => Promise.reject(echec)) } as unknown as BackupsService,
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

/** Le refus capturé, pour en lire le message. */
async function refus(appel: Promise<unknown>): Promise<Error> {
  try {
    await appel;
  } catch (error) {
    return error as Error;
  }
  throw new Error("l'appel devait échouer");
}

describe("panne du daemon relayée au client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rend un message générique, sans nom de node ni adresse interne", async () => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    for (const appel of [
      execution(PANNE).files(requete, "srv-1", "/"),
      fonctions(PANNE).restoreBackup(requete, "srv-1", "sauv-1", {}),
    ]) {
      const erreur = await refus(appel);
      expect(erreur).toBeInstanceOf(ServiceUnavailableException);
      expect(erreur.message).toBe(DAEMON_UNAVAILABLE_MESSAGE);
      expect(erreur.message).not.toContain("NODE-PARIS-03");
      expect(erreur.message).not.toContain("10.0.0.5");
    }
  });

  it("garde la cause pour l'exploitant, dans le journal du processus", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

    await refus(execution(PANNE).files(requete, "srv-1", "/"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ECONNREFUSED 10.0.0.5:8080"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("NODE-PARIS-03"));
  });

  it("laisse passer le refus que le daemon a écrit pour être lu", async () => {
    // « Format d'archive inconnu », « destination existante » : des phrases
    // faites pour l'écran, et qui disent quoi changer.
    const lisible = new WingsUnavailableError(
      "NODE-PARIS-03",
      "HTTP 400",
      400,
      "Cannot move or rename file, destination already exists.",
    );
    const erreur = await refus(execution(lisible).files(requete, "srv-1", "/"));
    expect(erreur).toBeInstanceOf(BadRequestException);
    expect(erreur.message).toBe("Cannot move or rename file, destination already exists.");
  });
});
