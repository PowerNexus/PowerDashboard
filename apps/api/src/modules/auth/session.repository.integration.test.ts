import { type Database, sessions } from "@gamedashboard/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedUser } from "../../test/fixtures";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { IMPERSONATION_TTL_MS } from "./impersonation";
import { SESSION_TTL_MS, SessionRepository } from "./session.repository";

/**
 * Durée de vie des sessions contre une vraie base (NC-03).
 *
 * Trente minutes d'inactivité, douze heures au plus (ASVS 3.3.2, niveau 2).
 * Les dates viennent de PostgreSQL, sous sa forme textuelle : c'est elle que
 * la règle doit savoir lire, et une doublure l'aurait écrite en ISO.
 */
describe.skipIf(!HAS_DATABASE)("durée de vie des sessions (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let repository: SessionRepository;
  let userId: string;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    repository = new SessionRepository(db);
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(sql.raw("truncate table users cascade"));
    userId = await seedUser(db);
  });

  /** Recule l'horloge d'une session : ouverture et dernière requête. */
  async function age(token: string, opened: string, seen: string | null) {
    const [row] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .limit(1);
    await db.execute(
      sql`update sessions
          set created_at = now() - ${opened}::interval,
              last_seen_at = ${seen === null ? null : sql`now() - ${seen}::interval`}
          where id = ${row?.id}`,
    );
    return token;
  }

  it("ouvre une session pour douze heures au plus", async () => {
    await repository.create(userId, {});
    const [row] = await db.select().from(sessions).where(eq(sessions.userId, userId));
    const lifetime = Date.parse(row?.expiresAt ?? "") - Date.parse(row?.createdAt ?? "");
    expect(Math.abs(lifetime - SESSION_TTL_MS)).toBeLessThan(5_000);
    expect(SESSION_TTL_MS).toBe(12 * 3600_000);
  });

  it("sert une session inactive depuis vingt-neuf minutes, et note la requête", async () => {
    const token = await age(await repository.create(userId, {}), "2 hours", "29 minutes");
    expect(await repository.resolve(token)).not.toBeNull();

    const [row] = await db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(Date.now() - Date.parse(row?.lastSeenAt ?? "")).toBeLessThan(60_000);
  });

  it("refuse une session inactive depuis trente et une minutes", async () => {
    const token = await age(await repository.create(userId, {}), "2 hours", "31 minutes");
    expect(await repository.resolve(token)).toBeNull();
    // Et ne la montre plus parmi les appareils connectés : la révoquer depuis
    // l'écran de sécurité ne fermerait rien.
    expect(await repository.listForUser(userId)).toEqual([]);
  });

  it("refuse une session jamais vue, ouverte depuis trente et une minutes", async () => {
    const token = await age(await repository.create(userId, {}), "31 minutes", null);
    expect(await repository.resolve(token)).toBeNull();
  });

  it("refuse une session active ouverte depuis plus de douze heures", async () => {
    const token = await age(await repository.create(userId, {}), "12 hours 1 minute", "1 minute");
    expect(await repository.resolve(token)).toBeNull();
    expect(await repository.listForUser(userId)).toEqual([]);
  });

  it("coupe aussi une session ouverte sous l'ancienne règle de sept jours", async () => {
    const token = await repository.create(userId, {});
    await age(token, "2 days", "1 minute");
    await db.execute(sql`update sessions set expires_at = now() + interval '5 days'`);
    expect(await repository.resolve(token)).toBeNull();
  });

  it("laisse à une prise en main sa demi-heure", async () => {
    const token = await repository.create(userId, { ttlMs: IMPERSONATION_TTL_MS });
    expect(await repository.resolve(token)).not.toBeNull();
    const [row] = await db.select().from(sessions).where(eq(sessions.userId, userId));
    const lifetime = Date.parse(row?.expiresAt ?? "") - Date.parse(row?.createdAt ?? "");
    expect(Math.abs(lifetime - IMPERSONATION_TTL_MS)).toBeLessThan(5_000);
  });
});
