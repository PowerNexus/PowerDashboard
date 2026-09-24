import { applicationKeys, type Database, users } from "@gamedashboard/db";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { ACTIVE_KEYS_MAX } from "../client/api-keys.service";
import { ApplicationKeysService } from "./application-keys.service";

describe.skipIf(!HAS_DATABASE)("clés applicatives (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let keys: ApplicationKeysService;
  let adminId: string;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    keys = new ApplicationKeysService(db);
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(sql.raw("truncate table users, application_keys cascade"));
    adminId = await seedUser(db);
  });

  const creer = (allowedIps: string[]) =>
    keys.create(adminId, { name: "Boutique", scopes: ["users.read"], allowedIps });

  describe("liste d'adresses", () => {
    /*
     * Non-régression (audit ASVS, NC-37) : les clés applicatives n'étaient
     * contrôlées que par une expression régulière. Un bloc CIDR était refusé
     * (la barre oblique n'y figurait pas), alors que la vérification à
     * l'usage sait les comparer ; `999.1.1.1` ou `:::` passaient, et la clé
     * devenait inutilisable sans que rien ne dise pourquoi.
     */
    it("accepte une adresse et un bloc CIDR, comme les clés personnelles", async () => {
      const { key } = await creer(["198.51.100.4", " 203.0.113.0/24 ", "2001:db8::/32"]);
      expect(key.allowedIps).toEqual(["198.51.100.4", "203.0.113.0/24", "2001:db8::/32"]);
    });

    it("refuse ce qui n'est pas une adresse", async () => {
      for (const entree of ["999.1.1.1", ":::", "203.0.113.0/33", "boutique.example"]) {
        await expect(creer([entree]), entree).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it("refuse un préfixe nul, qui ne restreindrait rien", async () => {
      await expect(creer(["0.0.0.0/0"])).rejects.toThrow(/0\.0\.0\.0\/0/);
      await expect(creer(["::/0"])).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  /*
   * Non-régression (audit ASVS, NC-38) : aucun plafond. Un revendeur, ou sa
   * clé de gestion détournée, émettait des clés sans limite.
   */
  describe("plafond de clés actives", () => {
    const emettre = (resellerId?: string) =>
      keys.create(adminId, { name: "Intégration", scopes: ["servers.read"], resellerId });

    async function revendeur(): Promise<string> {
      const id = await seedUser(db);
      await db.update(users).set({ role: "reseller" }).where(eq(users.id, id));
      return id;
    }

    it("refuse la vingt et unième clé active d'un revendeur, sans toucher aux autres", async () => {
      const a = await revendeur();
      const b = await revendeur();
      for (let i = 0; i < ACTIVE_KEYS_MAX; i += 1) await emettre(a);

      const refus = emettre(a);
      await expect(refus).rejects.toBeInstanceOf(ConflictException);
      await expect(refus).rejects.toThrow(/20 clés actives/);
      // Le plafond est celui du compte : un autre revendeur, ou la plateforme,
      // émettent toujours.
      await expect(emettre(b)).resolves.toBeDefined();
      await expect(emettre()).resolves.toBeDefined();
    });

    it("ne compte ni les clés révoquées, ni les clés échues", async () => {
      const a = await revendeur();
      const emises = [];
      for (let i = 0; i < ACTIVE_KEYS_MAX; i += 1) emises.push(await emettre(a));

      await keys.revoke(emises[0]?.key.id as string, a);
      await emettre(a);
      await db
        .update(applicationKeys)
        .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
        .where(eq(applicationKeys.id, emises[1]?.key.id as string));
      await expect(emettre(a)).resolves.toBeDefined();
    });

    it("plafonne aussi les clés de la plateforme, sous des émissions simultanées", async () => {
      const issues = await Promise.allSettled(
        Array.from({ length: ACTIVE_KEYS_MAX + 5 }, () => emettre()),
      );

      expect(issues.filter((issue) => issue.status === "fulfilled")).toHaveLength(ACTIVE_KEYS_MAX);
    });
  });
});
