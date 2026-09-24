import {
  defaultRolePresets,
  ROLE_PRESETS,
  ROLE_PRESETS_SETTING_KEY,
  SERVER_PERMISSIONS,
} from "@gamedashboard/contracts";
import { type Database, serverSubusers, settings, users } from "@gamedashboard/db";
import { BadRequestException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedLocation, seedNode, seedServer, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  NO_DATABASE_REASON,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import type { DenialLogService } from "../activity/denial-log.service";
import { ServerAccessService } from "../client/server-access.service";
import type { ServerInvitesService } from "../client/server-invites.service";
import { SubusersService } from "../client/subusers.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { WingsClientService } from "../wings/wings-client.service";
import type { WingsTokenService } from "../wings/wings-token.service";
import { PlatformSettingsService } from "./platform-settings.service";

/** Le journal des refus, muet : ces tests portent sur les droits accordés. */
const silence = { record: async () => {} } as unknown as DenialLogService;

/**
 * Presets de sous-utilisateurs redéfinis par l'administration, contre une
 * vraie base : la ligne de `settings`, son repli, sa suppression — et surtout
 * ce qu'une redéfinition **ne fait pas** aux accès déjà accordés.
 */
describe.skipIf(!HAS_DATABASE)("presets de sous-utilisateurs (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let platform: PlatformSettingsService;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    platform = new PlatformSettingsService(db);
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.delete(settings).where(eq(settings.key, ROLE_PRESETS_SETTING_KEY));
  });

  const élargi = {
    viewer: ["console.read", "console.send", "files.read"],
    moderator: [...ROLE_PRESETS.moderator],
    developer: [...ROLE_PRESETS.developer],
  };

  it("sert les presets du code tant que rien n'est enregistré", async () => {
    const view = await platform.rolePresets();
    expect(view.presets).toEqual(defaultRolePresets());
    expect(view.customized).toEqual([]);
  });

  it("enregistre, relit, puis rétablit les valeurs du code", async () => {
    await platform.saveRolePresets(élargi);
    const saved = await platform.rolePresets();
    expect(saved.presets.viewer).toEqual(élargi.viewer);
    expect(saved.customized).toEqual(["viewer"]);

    const reset = await platform.resetRolePresets();
    expect(reset.presets).toEqual(defaultRolePresets());
    expect((await platform.rolePresets()).presets).toEqual(defaultRolePresets());
    // La ligne disparaît : les défauts d'une version suivante s'appliqueront.
    const rows = await db.select().from(settings).where(eq(settings.key, ROLE_PRESETS_SETTING_KEY));
    expect(rows).toEqual([]);
  });

  it("refuse un jeu invalide sans rien écrire", async () => {
    await platform.saveRolePresets(élargi);

    for (const invalide of [
      { ...élargi, moderator: ["admin.users"] },
      { ...élargi, developer: ["files.everything"] },
      { ...élargi, owner: [...SERVER_PERMISSIONS] },
      undefined,
    ]) {
      await expect(platform.saveRolePresets(invalide)).rejects.toBeInstanceOf(BadRequestException);
    }
    // Le jeu précédent est intact : un refus n'a rien écrit à moitié.
    expect((await platform.rolePresets()).presets.viewer).toEqual(élargi.viewer);
  });

  it("n'est pas modifiable par l'enregistrement générique des réglages", async () => {
    // La clé vit hors du catalogue : `save()` doit continuer de la refuser,
    // sans quoi elle contournerait la validation des presets.
    await expect(
      platform.save({ [ROLE_PRESETS_SETTING_KEY]: { viewer: ["admin.x"] } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe("sous-utilisateurs existants", () => {
    let serverId: string;
    let invité: string;
    let ancien: string;
    let owner: string;
    let access: ServerAccessService;

    beforeAll(async () => {
      owner = await seedUser(db);
      invité = await seedUser(db);
      ancien = await seedUser(db);
      const nodeId = await seedNode(db, { locationId: await seedLocation(db) });
      serverId = await seedServer(db, { nodeId, ownerId: owner });
      access = new ServerAccessService(db, silence);

      // Le vrai service d'invitation : c'est lui qui décide de recopier les
      // permissions dans la ligne, et c'est ce qu'on veut voir tenir.
      const subusers = new SubusersService(
        db,
        {} as WingsClientService,
        {} as WingsTokenService,
        { notify: vi.fn(async () => {}) } as unknown as NotificationsService,
        {} as ServerInvitesService,
      );
      const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, invité));
      const viewer = (await platform.rolePresets()).presets.viewer;
      await subusers.invite(serverId, owner, row?.email ?? "", viewer);
      await subusers.accept(invité, serverId);

      // Une ligne ancienne, d'avant la recopie : liste vide, preset d'origine.
      await db.insert(serverSubusers).values({
        serverId,
        userId: ancien,
        permissions: [],
        rolePreset: "viewer",
        acceptedAt: new Date().toISOString(),
      });
    });

    it("gardent exactement ce qui leur a été accordé quand un preset change", async () => {
      const avant = await access.permissionsFor(invité, serverId);
      expect(avant).toEqual([...ROLE_PRESETS.viewer]);

      await platform.saveRolePresets(élargi);

      // L'invité ne gagne pas `console.send` : le preset n'est pas relu.
      expect(await access.permissionsFor(invité, serverId)).toEqual(avant);
      const [stored] = await db
        .select({ permissions: serverSubusers.permissions, preset: serverSubusers.rolePreset })
        .from(serverSubusers)
        .where(eq(serverSubusers.userId, invité));
      expect(stored).toEqual({ permissions: avant, preset: null });
    });

    it("une ligne ancienne retombe sur le preset du code, jamais sur celui redéfini", async () => {
      await platform.saveRolePresets(élargi);
      expect(await access.permissionsFor(ancien, serverId)).toEqual([...ROLE_PRESETS.viewer]);
    });
  });
});

// Vitest n'affiche pas la raison d'un `skipIf` : on la dit une fois.
if (!HAS_DATABASE) console.warn(NO_DATABASE_REASON);
