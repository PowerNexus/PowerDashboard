import { apiKeys, type Database } from "@gamedashboard/db";
import { ConflictException } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { ACTIVE_KEYS_MAX, ApiKeysService, CLIENT_KEY_MAX_DAYS } from "./api-keys.service";

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

  describe("liste d'adresses", () => {
    const creer = (allowedIps: string[]) =>
      keys.create(userId, "Bot Discord", ["console.read"], allowedIps);

    it("accepte une adresse et un bloc CIDR", async () => {
      const { key } = await creer(["198.51.100.4", "203.0.113.0/24", "2001:db8::/32"]);
      expect(key.allowedIps).toEqual(["198.51.100.4", "203.0.113.0/24", "2001:db8::/32"]);
    });

    /*
     * Non-régression (audit ASVS, NC-37) : `0.0.0.0/0` passait. La clé
     * s'affichait « restreinte » et s'ouvrait depuis n'importe où.
     */
    it("refuse un préfixe nul, qui ne restreindrait rien", async () => {
      await expect(creer(["0.0.0.0/0"])).rejects.toThrow(/0\.0\.0\.0\/0/);
      await expect(creer(["::/0"])).rejects.toThrow(/::\/0/);
    });
  });

  /*
   * Non-régression (audit ASVS, NC-38) : aucun plafond. Une session volée,
   * ou un script en boucle, semait des clés sans limite ; chacune est une
   * porte de plus à retrouver et à fermer.
   */
  describe("plafond de clés actives", () => {
    const creer = (nom = "Bot") => keys.create(userId, nom, ["console.read"], []);

    it("refuse la vingt et unième clé active, en le disant", async () => {
      for (let i = 0; i < ACTIVE_KEYS_MAX; i += 1) await creer(`Bot ${i}`);

      const refus = creer("Une de trop");
      await expect(refus).rejects.toBeInstanceOf(ConflictException);
      await expect(refus).rejects.toThrow(/20 clés actives/);
    });

    it("ne compte ni les clés révoquées, ni les clés échues, ni celles d'un autre compte", async () => {
      const cles = [];
      for (let i = 0; i < ACTIVE_KEYS_MAX; i += 1) cles.push(await creer(`Bot ${i}`));

      await keys.revoke(userId, cles[0]?.key.id as string);
      await creer("Remplaçante");
      await db
        .update(apiKeys)
        .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
        .where(eq(apiKeys.id, cles[1]?.key.id as string));
      await creer("Remplaçante bis");

      const autre = await seedUser(db);
      await expect(keys.create(autre, "Bot", ["console.read"], [])).resolves.toBeDefined();
    });

    it("tient sous des créations simultanées", async () => {
      // Compter puis insérer sans verrou laissait passer toutes les demandes
      // parallèles arrivées sous le plafond.
      const issues = await Promise.allSettled(
        Array.from({ length: ACTIVE_KEYS_MAX + 5 }, (_, i) => creer(`Bot ${i}`)),
      );

      expect(issues.filter((issue) => issue.status === "fulfilled")).toHaveLength(ACTIVE_KEYS_MAX);
      const [{ n }] = (await db.execute(
        sql`select count(*)::int as n from api_keys where user_id = ${userId}`,
      )) as unknown as [{ n: number }];
      expect(n).toBe(ACTIVE_KEYS_MAX);
    });
  });
});
