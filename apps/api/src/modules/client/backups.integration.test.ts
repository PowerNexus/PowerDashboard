import { backups, type Database, servers } from "@gamedashboard/db";
import { ConflictException } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedLocation, seedNode, seedServer, seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import type { S3Service } from "../storage/s3.service";
import { type WingsClientService, WingsUnavailableError } from "../wings/wings-client.service";
import type { WingsTokenService } from "../wings/wings-token.service";
import { BackupsService } from "./backups.service";

/**
 * Où vit l'archive, contre une vraie base.
 *
 * Le défaut corrigé : le panel demandait toujours l'adaptateur local à Wings,
 * même avec un compartiment réglé, et ne savait ni restaurer ni supprimer une
 * archive distante. Les sauvegardes mouraient avec la machine qu'elles
 * protégeaient. Tout se décide sur la colonne `disk` : c'est elle qu'on lit.
 *
 * Le daemon et le compartiment sont des doublures : seul le panel est sous test.
 */
describe.skipIf(!HAS_DATABASE)("BackupsService (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let serverId: string;
  let compartimentRegle: boolean;
  let lienSigne: string | null;

  const wings = {
    createBackup: vi.fn(async () => undefined),
    deleteBackup: vi.fn(async () => undefined),
    restoreBackup: vi.fn(async () => undefined),
  };
  const s3 = {
    isConfigured: vi.fn(async () => compartimentRegle),
    keyFor: vi.fn(async (serveur: string, sauvegarde: string) => `${serveur}/${sauvegarde}.tar.gz`),
    presignDownload: vi.fn(async () => lienSigne),
    discard: vi.fn(async () => undefined),
  };
  let service: BackupsService;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    service = new BackupsService(
      db,
      wings as unknown as WingsClientService,
      {
        backupDownloadGrant: async () => "https://node.test/grant",
      } as unknown as WingsTokenService,
      s3 as unknown as S3Service,
    );
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
    vi.clearAllMocks();
    compartimentRegle = true;
    lienSigne = "https://s3.exemple.test/signe";

    const locationId = await seedLocation(db);
    const nodeId = await seedNode(db, { locationId });
    serverId = await seedServer(db, { nodeId, ownerId: await seedUser(db) });
    await db.update(servers).set({ backupLimit: 5 }).where(eq(servers.id, serverId));
  });

  /** Une sauvegarde terminée, posée directement en base. */
  async function terminee(disk: "local" | "s3", uploadId: string | null = null): Promise<string> {
    const [row] = await db
      .insert(backups)
      .values({ serverId, name: "Nuit", disk, isSuccessful: true, uploadId })
      .returning({ id: backups.id });
    if (!row) throw new Error("sauvegarde non créée");
    return row.id;
  }

  async function ligne(id: string) {
    const [row] = await db.select().from(backups).where(eq(backups.id, id));
    return row;
  }

  it("avec un compartiment réglé, demande l'adaptateur s3 et retient le lieu", async () => {
    const creee = await service.create(serverId, "Avant mise à jour", ["logs"]);

    expect(wings.createBackup).toHaveBeenCalledWith(serverId, creee.id, ["logs"], "s3");
    expect((await ligne(creee.id))?.disk).toBe("s3");
  });

  it("sans compartiment, garde l'archive sur le disque du node", async () => {
    compartimentRegle = false;
    const creee = await service.create(serverId, "Avant mise à jour", []);

    expect(wings.createBackup).toHaveBeenCalledWith(serverId, creee.id, [], "wings");
    expect((await ligne(creee.id))?.disk).toBe("local");
  });

  it("restaure une archive distante par le lien signé", async () => {
    const id = await terminee("s3");
    await service.restore(serverId, id, true);

    expect(wings.restoreBackup).toHaveBeenCalledWith(
      serverId,
      id,
      true,
      "https://s3.exemple.test/signe",
    );
  });

  it("restaure une archive locale sans lien", async () => {
    const id = await terminee("local");
    await service.restore(serverId, id, false);

    expect(wings.restoreBackup).toHaveBeenCalledWith(serverId, id, false, undefined);
    expect(s3.presignDownload).not.toHaveBeenCalled();
  });

  it("refuse de restaurer une archive distante quand le compartiment n'est plus réglé", async () => {
    const id = await terminee("s3");
    lienSigne = null;

    await expect(service.restore(serverId, id, false)).rejects.toBeInstanceOf(ConflictException);
    expect(wings.restoreBackup).not.toHaveBeenCalled();
  });

  it("supprime une archive distante sans passer par le daemon, dépôt ouvert compris", async () => {
    const id = await terminee("s3", "depot-ouvert");
    await service.remove(serverId, id);

    expect(wings.deleteBackup).not.toHaveBeenCalled();
    expect(s3.discard).toHaveBeenCalledWith(`${serverId}/${id}.tar.gz`, "depot-ouvert");
    expect(await ligne(id)).toBeUndefined();
  });

  it("retire une sauvegarde locale que le node n'a plus", async () => {
    const id = await terminee("local");
    wings.deleteBackup.mockRejectedValueOnce(
      new WingsUnavailableError("N1", "HTTP 404", 404, "The requested backup was not found."),
    );

    await service.remove(serverId, id);
    expect(await ligne(id)).toBeUndefined();
  });

  it("garde la ligne quand le node ne répond pas", async () => {
    const id = await terminee("local");
    wings.deleteBackup.mockRejectedValueOnce(new WingsUnavailableError("N1", "délai dépassé"));

    await expect(service.remove(serverId, id)).rejects.toBeInstanceOf(WingsUnavailableError);
    expect(await ligne(id)).toBeDefined();
  });
});
