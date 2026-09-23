import { backups, type Database } from "@gamedashboard/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedLocation, seedNode, seedServer, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import type { NotificationsService } from "../notifications/notifications.service";
import type { S3Service } from "../storage/s3.service";
import { RemoteBackupService } from "./remote-backup.service";

/**
 * Comptes rendus de sauvegarde, contre une vraie base.
 *
 * Le défaut corrigé : `backups.bytes` était un `integer`, plafonné à 2 Gio.
 * Le compte rendu d'une archive plus grosse échouait à l'écriture, Wings
 * n'obtenait pas d'accusé de réception et effaçait l'archive. Seule une vraie
 * base PostgreSQL refuse la valeur : une doublure l'aurait acceptée.
 */
describe.skipIf(!HAS_DATABASE)("RemoteBackupService (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let service: RemoteBackupService;
  let nodeId: string;
  let backupId: string;
  let notifiees: string[];

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    const notifications = {
      notifyServerOwner: async (_id: string, input: { type: string }) => {
        notifiees.push(input.type);
      },
    } as unknown as NotificationsService;
    service = new RemoteBackupService(db, notifications, {} as S3Service);
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(
      sql.raw(
        `truncate table backups, servers, allocations, eggs, nests, nodes, locations, users cascade`,
      ),
    );
    notifiees = [];

    const locationId = await seedLocation(db);
    nodeId = await seedNode(db, { locationId });
    const serverId = await seedServer(db, { nodeId, ownerId: await seedUser(db) });
    const [row] = await db
      .insert(backups)
      .values({ serverId, name: "Monde entier" })
      .returning({ id: backups.id });
    if (!row) throw new Error("sauvegarde non créée");
    backupId = row.id;
  });

  it("enregistre une archive de plus de 2 Gio", async () => {
    const taille = 5 * 1024 ** 3;
    await service.complete(nodeId, backupId, {
      successful: true,
      size: taille,
      checksum: "0123456789abcdef",
      checksum_type: "sha1",
    });

    const [row] = await db.select().from(backups).where(eq(backups.id, backupId));
    expect(row?.isSuccessful).toBe(true);
    expect(row?.bytes).toBe(taille);
    expect(notifiees).toEqual([]);
  });
});
