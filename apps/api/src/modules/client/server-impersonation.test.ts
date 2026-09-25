import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ActivityService } from "../activity/activity.service";
import type { PlatformSettingsService } from "../admin/platform-settings.service";
import type { AuthenticatedRequest } from "../auth/session.guard";
import type { EngineService } from "../marketplace/engine.service";
import type { EulaService } from "../marketplace/eula.service";
import type { MarketplaceService } from "../marketplace/marketplace.service";
import type { WingsClientService } from "../wings/wings-client.service";
import type { WingsTokenService } from "../wings/wings-token.service";
import type { AllocationsService } from "./allocations.service";
import type { BackupsService } from "./backups.service";
import type { DatabasesService } from "./databases.service";
import type { FileUploadService } from "./file-upload.service";
import type { SchedulesService } from "./schedules.service";
import type { ServerAccessService } from "./server-access.service";
import { ServerFeaturesController } from "./server-features.controller";
import type { ServerInvitesService } from "./server-invites.service";
import type { ServerPlayersService } from "./server-players.service";
import { ServerRuntimeController } from "./server-runtime.controller";
import type { ServerSettingsService } from "./server-settings.service";
import type { ServerWebhooksService } from "./server-webhooks.service";
import type { SubusersService } from "./subusers.service";

/**
 * Les `GET` qui ont un effet, pendant une prise en main.
 *
 * Le garde de prise en main laisse passer tout `GET` : c'est la règle « lecture
 * seule ». Trois d'entre eux font pourtant sortir quelque chose du panel — un
 * lien de téléchargement de fichier, un lien de sauvegarde, le mot de passe
 * d'une base — et le journal les imputait au client : c'est sa session, son
 * identifiant. Un agent emportait l'archive d'un serveur, et le journal disait
 * que le client l'avait fait.
 */

const SERVEUR = "srv-1";
const AGENT = { id: "agent-1", email: "agent@gamedashboard.test" };

function requete(impersonator: typeof AGENT | null) {
  return {
    user: { id: "client-1", impersonator },
    scopes: null,
    ip: "127.0.0.1",
  } as unknown as AuthenticatedRequest & { ip?: string };
}

const access = {
  require: vi.fn(async () => ({ isOwner: true })),
  requireOperable: vi.fn(async () => {}),
};

function fonctions() {
  const databases = { password: vi.fn(async () => "mot-de-passe-mysql") };
  const backups = { downloadUrl: vi.fn(async () => "https://node.test/sauvegarde") };
  const activity = { record: vi.fn(async () => {}), labelFor: vi.fn(async () => "Client") };
  const controleur = new ServerFeaturesController(
    access as unknown as ServerAccessService,
    {} as ServerWebhooksService,
    backups as unknown as BackupsService,
    databases as unknown as DatabasesService,
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
  return { controleur, databases, activity };
}

function execution() {
  const tokens = { fileDownloadGrant: vi.fn(async () => "https://node.test/fichier") };
  const activity = { record: vi.fn(async () => {}), labelFor: vi.fn(async () => "Client") };
  const controleur = new ServerRuntimeController(
    access as unknown as ServerAccessService,
    {} as WingsClientService,
    {} as EulaService,
    tokens as unknown as WingsTokenService,
    activity as unknown as ActivityService,
    {} as FileUploadService,
    {} as ServerPlayersService,
  );
  return { controleur, activity };
}

/** Les propriétés de la seule ligne consignée. */
function consigne(activity: { record: ReturnType<typeof vi.fn> }): Record<string, unknown> {
  const [ligne] = activity.record.mock.calls[0] ?? [];
  return (ligne as { properties: Record<string, unknown> } | undefined)?.properties ?? {};
}

describe("prise en main : GET à effet", () => {
  it("refuse de révéler le mot de passe d'une base", async () => {
    // Un secret remis à l'agent, sous le nom du client : ni l'un ni l'autre
    // n'en a besoin pour « voir ce que voit le client ».
    const { controleur, databases, activity } = fonctions();

    await expect(
      controleur.databasePassword(requete(AGENT), SERVEUR, "db-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(databases.password).not.toHaveBeenCalled();
    expect(activity.record).not.toHaveBeenCalled();
  });

  it("révèle toujours le mot de passe au client lui-même", async () => {
    const { controleur } = fonctions();
    await expect(controleur.databasePassword(requete(null), SERVEUR, "db-1")).resolves.toEqual({
      data: { password: "mot-de-passe-mysql" },
    });
  });

  it("impute à l'agent le lien de sauvegarde qu'il tire", async () => {
    const { controleur, activity } = fonctions();
    await controleur.downloadBackup(requete(AGENT), SERVEUR, "sauv-1");
    expect(consigne(activity)).toMatchObject({
      backupId: "sauv-1",
      impersonator: AGENT.email,
      impersonatorId: AGENT.id,
    });
  });

  it("impute à l'agent le lien de fichier qu'il tire", async () => {
    const { controleur, activity } = execution();
    await controleur.downloadFile(requete(AGENT), SERVEUR, "/server.properties");
    expect(consigne(activity)).toMatchObject({
      file: "/server.properties",
      impersonator: AGENT.email,
      impersonatorId: AGENT.id,
    });
  });

  it("n'ajoute rien au journal d'une session ordinaire", async () => {
    const { controleur, activity } = execution();
    await controleur.downloadFile(requete(null), SERVEUR, "/server.properties");
    expect(consigne(activity)).toEqual({ file: "/server.properties" });
  });
});
