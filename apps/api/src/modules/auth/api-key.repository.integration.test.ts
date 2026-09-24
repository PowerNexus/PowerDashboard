import { apiKeys, type Database, users } from "@gamedashboard/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { ApiKeysService } from "../client/api-keys.service";
import { ApiKeyRepository } from "./api-key.repository";

/**
 * Qui porte une clé d'API personnelle, et quand elle se tait.
 *
 * `resolve` est le seul point par lequel une clé ouvre l'API cliente ; il
 * n'avait aucun test (audit ASVS, NC-64). Chaque cause de refus est vérifiée
 * ici contre une vraie base, la clé étant émise par le service réel.
 */
describe.skipIf(!HAS_DATABASE)("ApiKeyRepository.resolve (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let keys: ApiKeysService;
  let repository: ApiKeyRepository;
  let userId: string;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    keys = new ApiKeysService(db);
    repository = new ApiKeyRepository(db);
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(sql.raw("truncate table users cascade"));
    userId = await seedUser(db);
  });

  const emettre = (allowedIps: string[] = []) =>
    keys.create(userId, "Bot Discord", ["console.read", "power.start"], allowedIps, 30);

  it("rend le compte et les portées de la clé", async () => {
    const { plaintext, key } = await emettre();

    const principal = await repository.resolve(plaintext, "203.0.113.7");

    expect(principal?.keyId).toBe(key.id);
    expect(principal?.user.id).toBe(userId);
    expect(principal?.scopes).toEqual(["console.read", "power.start"]);
    expect(principal?.user.authMethod).toBe("api-key");
    expect(principal?.user.impersonator).toBeNull();
  });

  it("refuse un secret faux sous un préfixe existant, et une clé inventée", async () => {
    const { plaintext } = await emettre();
    const dernier = plaintext.at(-1) === "a" ? "b" : "a";

    expect(await repository.resolve(`${plaintext.slice(0, -1)}${dernier}`, undefined)).toBeNull();
    expect(await repository.resolve("gd_live_inventee", undefined)).toBeNull();
    expect(await repository.resolve("pas-une-cle", undefined)).toBeNull();
  });

  it("se tait dès la révocation", async () => {
    const { plaintext, key } = await emettre();
    await keys.revoke(userId, key.id);

    expect(await repository.resolve(plaintext, undefined)).toBeNull();
  });

  it("se tait à son échéance, pas avant", async () => {
    const { plaintext, key } = await emettre();
    expect(await repository.resolve(plaintext, undefined)).not.toBeNull();

    await db
      .update(apiKeys)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(apiKeys.id, key.id));

    expect(await repository.resolve(plaintext, undefined)).toBeNull();
  });

  it("se tait avec le compte suspendu, et revient avec lui", async () => {
    const { plaintext } = await emettre();
    await db.update(users).set({ suspendedAt: sql`now()` }).where(eq(users.id, userId));
    expect(await repository.resolve(plaintext, undefined)).toBeNull();

    await db.update(users).set({ suspendedAt: null }).where(eq(users.id, userId));
    expect(await repository.resolve(plaintext, undefined)).not.toBeNull();
  });

  describe("liste d'adresses", () => {
    it("n'ouvre que depuis une adresse de la liste", async () => {
      const { plaintext } = await emettre(["198.51.100.4", "203.0.113.0/24"]);

      expect(await repository.resolve(plaintext, "198.51.100.4")).not.toBeNull();
      expect(await repository.resolve(plaintext, "203.0.113.200")).not.toBeNull();
      expect(await repository.resolve(plaintext, "198.51.100.5")).toBeNull();
      expect(await repository.resolve(plaintext, "2001:db8::1")).toBeNull();
    });

    it("reconnaît l'adresse vue à travers une pile IPv6", async () => {
      const { plaintext } = await emettre(["198.51.100.4"]);

      expect(await repository.resolve(plaintext, "::ffff:198.51.100.4")).not.toBeNull();
    });

    it("refuse quand l'adresse de l'appelant est inconnue", async () => {
      // Sans adresse, on ne peut pas prouver qu'elle est dans la liste :
      // laisser passer ferait d'une restriction une option.
      const { plaintext } = await emettre(["198.51.100.4"]);

      expect(await repository.resolve(plaintext, undefined)).toBeNull();
    });
  });

  it("horodate l'usage de la clé", async () => {
    const { plaintext, key } = await emettre();

    await repository.resolve(plaintext, undefined);

    // Écrit sans attendre la réponse : on laisse à l'écriture le temps d'aboutir.
    await expect
      .poll(async () => {
        const [row] = await db
          .select({ lastUsedAt: apiKeys.lastUsedAt })
          .from(apiKeys)
          .where(eq(apiKeys.id, key.id));
        return row?.lastUsedAt ?? null;
      })
      .not.toBeNull();
  });
});
