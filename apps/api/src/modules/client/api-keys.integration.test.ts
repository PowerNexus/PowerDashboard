import type { Database } from "@gamedashboard/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { ApiKeysService, CLIENT_KEY_MAX_DAYS } from "./api-keys.service";

const JOUR_MS = 86_400_000;

describe.skipIf(!HAS_DATABASE)("clés d'API personnelles (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let keys: ApiKeysService;
  let userId: string;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    keys = new ApiKeysService(db);
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(sql.raw("truncate table users cascade"));
    userId = await seedUser(db);
  });

  describe("échéance", () => {
    /*
     * Non-régression (audit ASVS, NC-36) : sans durée demandée, la clé ne
     * finissait jamais. Une clé collée dans un script puis oubliée restait
     * valable des années, là où les clés applicatives sont bornées à un an.
     */
    it("pose l'échéance maximale quand aucune n'est demandée", async () => {
      const avant = Date.now();
      const { key } = await keys.create(userId, "Bot Discord", ["console.read"], []);

      expect(key.expiresAt).not.toBeNull();
      const jours = (Date.parse(key.expiresAt as string) - avant) / JOUR_MS;
      expect(jours).toBeGreaterThanOrEqual(CLIENT_KEY_MAX_DAYS);
      expect(jours).toBeLessThan(CLIENT_KEY_MAX_DAYS + 1);
    });

    it("garde la durée demandée, dans la borne", async () => {
      const avant = Date.now();
      const { key } = await keys.create(userId, "Sauvegarde", ["console.read"], [], 30);

      const jours = (Date.parse(key.expiresAt as string) - avant) / JOUR_MS;
      expect(Math.round(jours)).toBe(30);
      await expect(
        keys.create(userId, "Trop long", ["console.read"], [], CLIENT_KEY_MAX_DAYS + 1),
      ).rejects.toThrow(/1 à 365 jours/);
    });
  });
});
