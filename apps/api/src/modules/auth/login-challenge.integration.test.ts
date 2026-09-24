import { type Database, sessions, users } from "@gamedashboard/db";
import { Logger } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { ActivityService } from "../activity/activity.service";
import type { AuthController } from "./auth.controller";
import { AuthTokenRepository } from "./auth-token.repository";
import { issueChallenge } from "./login-challenge";
import type { SecurityAlertService } from "./security-alert.service";
import { SessionRepository } from "./session.repository";
import { SessionIssuerService } from "./session-issuer.service";
import { TwoFactorRepository } from "./two-factor.repository";
import { UserRepository } from "./user.repository";

/**
 * Un défi de connexion ne sert qu'une fois, **quel que soit le processus**
 * (NC-30).
 *
 * La liste des défis consommés vivait dans la mémoire du processus : un
 * défi servi sur une instance de l'API se rejouait sur une autre, ou sur la
 * même après un redémarrage, pendant ses cinq minutes de validité. Le
 * contrôleur suppose pourtant ailleurs plusieurs instances — c'est pour cela
 * que le défi WebAuthn voyage scellé plutôt que gardé en mémoire.
 *
 * Le second processus est simulé en rechargeant les modules : tout ce qui
 * vit en mémoire repart de zéro, seule la base reste.
 */

process.env.APP_SECRET_KEY ??= "clé de test des défis de connexion, jamais employée ailleurs";

function fakeReply() {
  const reply = {
    statusCode: 200,
    cookies: new Map<string, string>(),
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    header: () => reply,
    setCookie(name: string, value: string) {
      reply.cookies.set(name, value);
      return reply;
    },
    clearCookie: () => reply,
    send() {},
  };
  return reply;
}

const REQUEST = {
  ip: "203.0.113.7",
  headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0" },
  socket: { remoteAddress: "127.0.0.1" },
};

describe.skipIf(!HAS_DATABASE)("défis de connexion consommés en base (intégration)", () => {
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

  beforeEach(async () => {
    await db.execute(sql.raw("truncate table users, login_attempts, activity_logs cascade"));
  });

  /** Un contrôleur tel qu'un processus de l'API le construit, sur la base partagée. */
  async function processus(): Promise<AuthController> {
    const { AuthController } = await import("./auth.controller");
    const usersRepo = new UserRepository(db);
    const sessionsRepo = new SessionRepository(db);
    const issuer = new SessionIssuerService(sessionsRepo, usersRepo, {
      afterSignIn: () => undefined,
    } as unknown as SecurityAlertService);
    const args: unknown[] = Array.from({ length: 18 }, () => ({}));
    args[0] = usersRepo;
    args[1] = sessionsRepo;
    args[2] = new ActivityService(db);
    args[3] = new TwoFactorRepository(db);
    args[8] = issuer;
    args[9] = new AuthTokenRepository(db);
    args[14] = { afterFailure: () => undefined };
    return new (AuthController as unknown as new (...a: unknown[]) => AuthController)(...args);
  }

  async function compteAvecCodesDeSecours() {
    const [row] = await db
      .insert(users)
      .values({
        email: `titulaire-${Math.random().toString(16).slice(2, 8)}@gamedashboard.test`,
        nameFirst: "Alex",
        nameLast: "Titulaire",
        passwordHash: null,
      })
      .returning({ id: users.id });
    if (!row) throw new Error("compte non créé");
    const codes = await new TwoFactorRepository(db).ensureRecoveryCodes(row.id);
    if (!codes || codes.length < 2) throw new Error("codes de secours non créés");
    return { id: row.id, codes };
  }

  it("refuse sur une autre instance un défi déjà servi", async () => {
    const compte = await compteAvecCodesDeSecours();
    const challenge = issueChallenge("login", compte.id, { method: "password" });

    const premier = fakeReply();
    await (await processus()).loginTwoFactor(
      { challenge, recoveryCode: compte.codes[0] },
      REQUEST as never,
      premier as never,
    );
    expect(premier.statusCode).toBe(200);
    expect(premier.cookies.size).toBe(1);

    // Une autre instance, ou la même après un redémarrage : rien en mémoire.
    vi.resetModules();
    const rejeu = fakeReply();
    await (await processus()).loginTwoFactor(
      { challenge, recoveryCode: compte.codes[1] },
      REQUEST as never,
      rejeu as never,
    );

    expect(rejeu.statusCode).toBe(401);
    expect(rejeu.cookies.size).toBe(0);
    const ouvertes = await db.select().from(sessions).where(eq(sessions.userId, compte.id));
    expect(ouvertes).toHaveLength(1);
  });

  it("ne consomme le défi qu'une fois, même sous des demandes simultanées", async () => {
    const compte = await compteAvecCodesDeSecours();
    const tokens = new AuthTokenRepository(db);
    const jti = "0b6f3a4e-6d7c-4b8a-9e1f-2a3b4c5d6e7f";
    const expiresAt = Date.now() + 60_000;

    const claims = await Promise.all(
      Array.from({ length: 8 }, () => tokens.claimChallenge({ jti, userId: compte.id, expiresAt })),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await tokens.challengeClaimed(jti)).toBe(true);
    expect(await tokens.challengeClaimed("11111111-2222-4333-8444-555555555555")).toBe(false);
  });
});
