import { activityLogs, type Database } from "@gamedashboard/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { seedLocation, seedNode, seedServer, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { ActivityService } from "../activity/activity.service";
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
 * Le journal d'un serveur, lu par quelqu'un qui n'en est pas propriétaire.
 *
 * `activity.read` est dans le préréglage « lecteur » : un invité à qui l'on
 * confie la lecture de la console voyait l'adresse IP de chaque acteur — celle
 * du propriétaire, de ses autres invités, de l'assistance. Une donnée
 * personnelle qui ne lui sert à rien pour comprendre ce qui est arrivé au
 * serveur. Le journal est lu en base ; seul le contrôle d'accès est une
 * doublure.
 */
describe.skipIf(!HAS_DATABASE)("GET activity — adresses des acteurs", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let serverId: string;
  const IP = "198.51.100.23";

  function controleur(isOwner: boolean) {
    return new ServerFeaturesController(
      { require: vi.fn(async () => ({ isOwner })) } as unknown as ServerAccessService,
      {} as ServerWebhooksService,
      {} as BackupsService,
      {} as DatabasesService,
      {} as AllocationsService,
      {} as SubusersService,
      {} as ServerInvitesService,
      {} as SchedulesService,
      {} as ServerSettingsService,
      new ActivityService(db),
      {} as WingsClientService,
      {} as MarketplaceService,
      {} as EngineService,
      {} as EulaService,
      {} as PlatformSettingsService,
    );
  }

  const requete = { user: { id: "u-1" }, scopes: null } as unknown as AuthenticatedRequest;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    const owner = await seedUser(db);
    const nodeId = await seedNode(db, { locationId: await seedLocation(db) });
    serverId = await seedServer(db, { nodeId, ownerId: owner });
    await db.insert(activityLogs).values({
      actorId: owner,
      actorType: "user",
      actorLabel: "Propriétaire",
      serverId,
      event: "server.power",
      ip: IP,
      properties: { signal: "start" },
      at: new Date().toISOString(),
    });
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  it("masque l'adresse des acteurs à qui n'est pas propriétaire", async () => {
    const { data } = await controleur(false).listActivity(requete, serverId);
    expect(data).toHaveLength(1);
    expect(data[0]?.ip).toBeNull();
    // Le reste de la ligne demeure : c'est ce qui sert à comprendre.
    expect(data[0]).toMatchObject({ event: "server.power", actorLabel: "Propriétaire" });
  });

  it("ne laisse pas deviner l'adresse par la recherche", async () => {
    // Chercher « 198.51.100 » et voir la ligne apparaître ou non dirait
    // l'adresse aussi sûrement que de l'afficher.
    const { data } = await controleur(false).listActivity(requete, serverId, "198.51.100");
    expect(data).toEqual([]);
  });

  it("la montre au propriétaire, et la laisse chercher", async () => {
    expect((await controleur(true).listActivity(requete, serverId)).data[0]?.ip).toBe(IP);
    expect(await controleur(true).listActivity(requete, serverId, "198.51.100")).toMatchObject({
      data: [{ ip: IP }],
    });
  });
});
