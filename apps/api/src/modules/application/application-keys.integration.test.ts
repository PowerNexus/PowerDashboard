import type { Database } from "@gamedashboard/db";
import { BadRequestException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
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
});
