import { BadRequestException } from "@nestjs/common";
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
 * Validation positive des entrées : ce qui n'a pas la forme attendue ne va
 * pas plus loin que le contrôleur.
 *
 * L'invitation ne vérifiait qu'un « @ » (`includes("@")`) : `@`, `a@` ou
 * `x@y` partaient chercher un compte et fabriquer une invitation. L'image
 * Docker choisie par le client n'avait pas de longueur maximale.
 */

const SERVEUR = "srv-1";
const requete = {
  user: { id: "u-1" },
  scopes: null,
  ip: "127.0.0.1",
  headers: {},
} as unknown as AuthenticatedRequest & { ip?: string };

function monter() {
  const access = {
    require: vi.fn(async () => ({ isOwner: true })),
    requireOperable: vi.fn(async () => {}),
  };
  const subusers = {
    invite: vi.fn(async () => ({ id: "s-1", email: "alex@exemple.fr", permissions: [] })),
  };
  const settings = { setDockerImage: vi.fn(async () => {}) };
  const activity = { record: vi.fn(async () => {}), labelFor: vi.fn(async () => "Matheo") };
  const controleur = new ServerFeaturesController(
    access as unknown as ServerAccessService,
    {} as ServerWebhooksService,
    {} as BackupsService,
    {} as DatabasesService,
    {} as AllocationsService,
    subusers as unknown as SubusersService,
    {} as ServerInvitesService,
    {} as SchedulesService,
    settings as unknown as ServerSettingsService,
    activity as unknown as ActivityService,
    {} as WingsClientService,
    {} as MarketplaceService,
    {} as EngineService,
    {} as EulaService,
    {} as PlatformSettingsService,
  );
  return { controleur, subusers, settings };
}

describe("POST subusers — adresse de l'invité", () => {
  it.each(["@", "a@", "@b", "x@y z", "pas une adresse"])("refuse « %s »", async (email) => {
    const { controleur, subusers } = monter();
    await expect(
      controleur.inviteSubuser(requete, SERVEUR, { email, permissions: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(subusers.invite).not.toHaveBeenCalled();
  });

  it("refuse une adresse démesurée", async () => {
    const { controleur, subusers } = monter();
    await expect(
      controleur.inviteSubuser(requete, SERVEUR, {
        email: `${"a".repeat(300)}@exemple.fr`,
        permissions: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(subusers.invite).not.toHaveBeenCalled();
  });

  it("accepte une adresse bien formée, débarrassée de ses espaces", async () => {
    const { controleur, subusers } = monter();
    await controleur.inviteSubuser(requete, SERVEUR, {
      email: " alex@exemple.fr ",
      permissions: ["console.read"],
    });
    expect(subusers.invite).toHaveBeenCalledWith(
      SERVEUR,
      "u-1",
      "alex@exemple.fr",
      ["console.read"],
      null,
    );
  });
});

describe("POST settings/docker-image", () => {
  it("refuse une image démesurée, avant tout le reste", async () => {
    const { controleur, settings } = monter();
    await expect(
      controleur.setDockerImage(requete, SERVEUR, { image: `ghcr.io/${"x".repeat(300)}` }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(settings.setDockerImage).not.toHaveBeenCalled();
  });
});

describe("POST marketplace/install — version choisie", () => {
  it.each([
    ["vide", ""],
    ["non textuelle", 42],
    ["démesurée", "1".repeat(300)],
  ])("refuse une version %s, avant tout le reste", async (_cas, version) => {
    const { controleur } = monter();
    await expect(
      controleur.installAddon(requete, SERVEUR, { projectId: "modrinth:abc", version }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
