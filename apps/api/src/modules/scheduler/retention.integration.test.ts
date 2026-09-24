import { randomBytes } from "node:crypto";
import { applicationKeys, type Database, idempotencyRecords } from "@gamedashboard/db";
import { Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { RetentionService } from "./retention.service";

const JOUR_MS = 86_400_000;

/**
 * La rétention contre une vraie base : une règle dont la table ou la colonne
 * est mal nommée ne se verrait qu'à l'exécution, en faisant échouer le tour
 * entier — et donc la purge de toutes les autres tables.
 */
describe.skipIf(!HAS_DATABASE)("rétention (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  it("efface les réponses d'idempotence de plus d'un mois, et elles seules", async () => {
    const [cle] = await db
      .insert(applicationKeys)
      .values({
        name: "Boutique",
        prefix: `gd_app_${randomBytes(4).toString("hex")}`,
        keyHash: "test",
        scopes: ["servers.create"],
      })
      .returning({ id: applicationKeys.id });
    const memoriser = (idempotencyKey: string, ageJours: number) =>
      db.insert(idempotencyRecords).values({
        applicationKeyId: cle?.id as string,
        idempotencyKey,
        endpoint: "POST /servers",
        requestHash: "condensat",
        // La réponse complète d'une création : c'est elle qu'on ne garde pas.
        response: { data: { email: "client@exemple.test", name: "Client" } },
        createdAt: new Date(Date.now() - ageJours * JOUR_MS).toISOString(),
      });
    await memoriser("hostbill-service-ancien", 31);
    await memoriser("hostbill-service-recent", 29);

    const retention = new RetentionService(db);
    await retention.tick();

    expect(retention.report().failure).toBeNull();
    const restantes = await db
      .select({ key: idempotencyRecords.idempotencyKey })
      .from(idempotencyRecords);
    expect(restantes.map((row) => row.key)).toEqual(["hostbill-service-recent"]);
  });

  /**
   * Le décompte des lignes retirées se lisait dans `rowCount`, qui n'existe
   * pas avec postgres-js (le client rend `count`). Chaque tranche valait donc
   * zéro : l'écran annonçait « 0 ligne » quoi qu'il arrive, et la boucle
   * s'arrêtait après la première tranche, faute de la croire pleine — une
   * table en retard ne se rattrapait que de 20 000 lignes par heure.
   */
  it("compte les lignes retirées et enchaîne les tranches pleines", async () => {
    const TRANCHE = 20_000;
    await db.execute(sql`
      insert into login_attempts (email, ip, success, at)
      select 'ancien@gamedashboard.test', '203.0.113.7', false, now() - interval '31 days'
      from generate_series(1, ${TRANCHE + 5})
    `);

    const retention = new RetentionService(db);
    await retention.tick();

    const ligne = retention.report().tables.find((table) => table.table === "login_attempts");
    expect(ligne?.rows).toBe(TRANCHE + 5);
    const [reste] = (await db.execute(
      sql`select count(*)::int as n from login_attempts`,
    )) as unknown as Array<{ n: number }>;
    expect(reste?.n).toBe(0);
  }, 60_000);
});
