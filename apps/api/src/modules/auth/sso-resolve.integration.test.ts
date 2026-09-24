import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SsoProfile } from "@gamedashboard/contracts";
import { type Database, userOauthAccounts, users } from "@gamedashboard/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import type { PlatformSettingsService } from "../admin/platform-settings.service";
import { SsoExchangeError, SsoService } from "./sso.service";

/**
 * Le rapprochement SSO contre une vraie base.
 *
 * `sso-resolve.test.ts` éprouve l'ordre des décisions sur une base simulée.
 * Ce qui suit ne se voit qu'en SQL : la casse des adresses face à l'index
 * d'unicité (NC-28), et deux cérémonies concurrentes sur un même compte
 * (doute D-7 de l'audit).
 */

function profil(surcharge: Partial<SsoProfile> = {}): SsoProfile {
  return {
    subject: "sub-du-fournisseur",
    email: "paul@exemple.fr",
    emailVerified: true,
    nameFirst: "Paul",
    nameLast: "Martin",
    ...surcharge,
  };
}

describe.skipIf(!HAS_DATABASE)("rapprochement SSO (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let sso: SsoService;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    sso = new SsoService(db, {
      ssoConfiguration: async () => null,
    } as unknown as PlatformSettingsService);
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(sql.raw("truncate table users cascade"));
  });

  async function compte(email: string): Promise<string> {
    const [row] = await db
      .insert(users)
      .values({ email, nameFirst: "Paul", nameLast: "Martin", passwordHash: null })
      .returning({ id: users.id });
    if (!row) throw new Error("compte non créé");
    return row.id;
  }

  const adresseDe = async (id: string) =>
    (await db.select({ email: users.email }).from(users).where(eq(users.id, id)))[0]?.email;

  describe("casse des adresses (NC-28)", () => {
    it("crée le compte sous l'adresse en minuscules", async () => {
      const { id, created } = await sso.resolveUser(profil({ email: "Paul.Martin@Exemple.FR" }));

      expect(created).toBe(true);
      expect(await adresseDe(id)).toBe("paul.martin@exemple.fr");
    });

    it("réaligne le compte sur l'adresse du fournisseur, en minuscules", async () => {
      const id = await compte("paul@exemple.fr");
      await sso.resolveUser(profil());

      await sso.resolveUser(profil({ email: "Paul.Nouveau@Exemple.FR" }));
      expect(await adresseDe(id)).toBe("paul.nouveau@exemple.fr");
    });

    it("refuse en base deux comptes dont l'adresse ne diffère que par la casse", async () => {
      // Toutes les lectures comparent en `lower()` : un second compte « Paul@… »
      // rendrait le rapprochement ambigu, et la connexion par mot de passe
      // prendrait l'un ou l'autre au hasard de l'ordre des lignes.
      await compte("paul@exemple.fr");
      await expect(compte("Paul@Exemple.fr")).rejects.toThrow();
    });

    it("migre une base qui porte déjà des doublons de casse sans arrêter la livraison", async () => {
      /*
       * Une migration qui échoue en production arrête la livraison : c'est
       * pire que le défaut. Sur une base où deux comptes ne diffèrent que par
       * la casse, elle doit laisser l'ancien index et le dire ; puis poser le
       * nouveau une fois les doublons résolus.
       */
      const migration = lireMigration("_users_email_lower_unique.sql");

      const definition = async () => {
        const [ligne] = await db.execute<{ indexdef: string }>(
          sql.raw("select indexdef from pg_indexes where indexname = 'users_email_unique'"),
        );
        return ligne?.indexdef ?? "";
      };

      // L'état d'avant : l'index sur la colonne brute, et deux comptes jumeaux.
      await db.execute(sql.raw('drop index "users_email_unique"'));
      await db.execute(sql.raw('create unique index "users_email_unique" on "users" ("email")'));
      await compte("paul@exemple.fr");
      const jumeau = await compte("Paul@Exemple.fr");

      await expect(db.execute(sql.raw(migration))).resolves.toBeDefined();
      expect(await definition()).not.toContain("lower");

      await db.delete(users).where(eq(users.id, jumeau));
      await db.execute(sql.raw(migration));
      expect(await definition()).toContain("lower((email)::text)");
    });
  });

  describe("liaison concurrente (D-7)", () => {
    /*
     * Un compte ne porte qu'une identité par fournisseur : une seconde, qui
     * partagerait son adresse, est refusée (« déjà lié à une autre
     * identité »). Le contrôle lisait la liaison existante **puis**
     * l'écrivait, sans index pour trancher entre deux cérémonies menées en
     * même temps : les deux lisaient « aucune liaison », et les deux
     * écrivaient la leur.
     *
     * Plusieurs essais : la course ne se produit que si les deux lectures
     * précèdent les deux écritures, ce que l'ordonnancement ne garantit pas à
     * chaque fois.
     */
    it("ne lie jamais deux identités du même fournisseur à un compte", async () => {
      for (let essai = 0; essai < 10; essai += 1) {
        await db.execute(sql.raw("truncate table users cascade"));
        const id = await compte("paul@exemple.fr");

        const issues = await Promise.allSettled([
          sso.resolveUser(profil({ subject: "identite-a" }), { provider: "oidc" }),
          sso.resolveUser(profil({ subject: "identite-b" }), { provider: "oidc" }),
        ]);

        const liaisons = await db
          .select({ sujet: userOauthAccounts.providerUserId })
          .from(userOauthAccounts)
          .where(eq(userOauthAccounts.userId, id));
        expect(liaisons).toHaveLength(1);

        // Seule l'identité liée ouvre le compte ; l'autre reçoit le refus
        // rédigé, et non une erreur SQL que le contrôleur tairait.
        const ouvertes = issues.filter((issue) => issue.status === "fulfilled");
        expect(ouvertes).toEqual([{ status: "fulfilled", value: { id, created: false } }]);
        const refus = issues.find((issue) => issue.status === "rejected");
        expect(refus?.status === "rejected" && refus.reason).toBeInstanceOf(SsoExchangeError);
      }
    });

    it("laisse deux cérémonies de la même identité aboutir toutes deux", async () => {
      const id = await compte("paul@exemple.fr");

      const issues = await Promise.all([
        sso.resolveUser(profil(), { provider: "oidc" }),
        sso.resolveUser(profil(), { provider: "oidc" }),
      ]);

      expect(issues).toEqual([
        { id, created: false },
        { id, created: false },
      ]);
      const liaisons = await db
        .select()
        .from(userOauthAccounts)
        .where(eq(userOauthAccounts.userId, id));
      expect(liaisons).toHaveLength(1);
    });

    it("migre une base où la course a déjà lié deux identités sans arrêter la livraison", async () => {
      const migration = lireMigration("_oauth_user_provider_unique.sql");
      const present = async () =>
        (
          await db.execute<{ n: number }>(
            sql.raw(
              "select count(*)::int as n from pg_indexes where indexname = 'oauth_user_provider_unique'",
            ),
          )
        )[0]?.n === 1;

      await db.execute(sql.raw('drop index "oauth_user_provider_unique"'));
      const id = await compte("paul@exemple.fr");
      for (const sujet of ["identite-a", "identite-b"]) {
        await db.insert(userOauthAccounts).values({
          userId: id,
          provider: "oidc",
          providerUserId: sujet,
          email: "paul@exemple.fr",
        });
      }

      await expect(db.execute(sql.raw(migration))).resolves.toBeDefined();
      expect(await present()).toBe(false);

      await db.delete(userOauthAccounts).where(eq(userOauthAccounts.providerUserId, "identite-b"));
      await db.execute(sql.raw(migration));
      expect(await present()).toBe(true);
    });
  });
});

/** Le texte d'une migration, retrouvé par son nom : l'intégration peut la renuméroter. */
function lireMigration(suffixe: string): string {
  const dossier = fileURLToPath(new URL("../../../../../packages/db/migrations", import.meta.url));
  const fichier = readdirSync(dossier).find((nom) => nom.endsWith(suffixe));
  return readFileSync(join(dossier, fichier ?? "introuvable"), "utf8");
}
