import { randomBytes } from "node:crypto";
import { applicationKeys, type Database, idempotencyRecords } from "@gamedashboard/db";
import { Logger } from "@nestjs/common";
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
});
