import { type Database, loginAttempts, sessions, users } from "@gamedashboard/db";
import { Logger } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
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
import { PasswordConfirmationService } from "./password-confirmation.service";
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
    body: undefined as unknown,
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
    send(body: unknown) {
      reply.body = body;
    },
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
  async function processus(passkeyService: unknown = {}): Promise<AuthController> {
    const { AuthController } = await import("./auth.controller");
    const usersRepo = new UserRepository(db);
    const sessionsRepo = new SessionRepository(db);
    const issuer = new SessionIssuerService(sessionsRepo, usersRepo, {
      afterSignIn: () => undefined,
    } as unknown as SecurityAlertService);
    const args: unknown[] = Array.from({ length: 20 }, () => ({}));
    args[0] = usersRepo;
    args[1] = sessionsRepo;
    args[2] = new ActivityService(db);
    args[3] = new TwoFactorRepository(db);
    args[5] = passkeyService;
    args[8] = issuer;
    args[9] = new AuthTokenRepository(db);
    args[14] = { afterFailure: () => undefined };
    // Le verrou des tentatives, que le second facteur consulte (NC-20, NC-29).
    args[18] = new PasswordConfirmationService(usersRepo, {
      afterFailure: () => undefined,
    } as unknown as SecurityAlertService);
    // La marque du domaine d'arrivée : la plateforme, faute d'en-tête.
    args[19] = { forHost: async () => ({ name: "GameDashboard", resellerId: null }) };
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

  /**
   * NC-32 : le défi `login` survivait à une connexion par clé d'accès.
   *
   * Seul le défi `passkey-login`, dérivé du premier, était consommé : le défi
   * `login` restait valable cinq minutes après la connexion, et rouvrait une
   * session avec un code de secours ou une nouvelle cérémonie.
   */
  it("consomme le défi de connexion quand la clé d'accès a ouvert la session", async () => {
    vi.stubEnv("PANEL_ORIGIN", "https://panel.gamedashboard.test");
    try {
      const compte = await compteAvecCodesDeSecours();
      const challenge = issueChallenge("login", compte.id, { method: "password" });
      // Seule la vérification cryptographique est simulée : elle n'est pas
      // en cause, et le reste — défis, consommation, session — est réel.
      const auth = await processus({
        authenticationOptions: async () => ({ challenge: "defi-webauthn" }),
        verifyAuthentication: async () => true,
      });

      const options = fakeReply();
      await auth.passkeyAuthenticationOptions({ challenge }, REQUEST as never, options as never);
      const ceremonie = (options.body as { data: { challenge: string } }).data.challenge;

      const passkey = fakeReply();
      await auth.loginWithPasskey(
        { challenge: ceremonie, response: {} },
        REQUEST as never,
        passkey as never,
      );
      expect(passkey.statusCode).toBe(200);
      expect(passkey.cookies.size).toBe(1);

      // Le même défi de connexion ne rouvre plus rien : ni par un code de
      // secours, ni par une nouvelle cérémonie.
      const rejeu = fakeReply();
      await auth.loginTwoFactor(
        { challenge, recoveryCode: compte.codes[0] },
        REQUEST as never,
        rejeu as never,
      );
      expect(rejeu.statusCode).toBe(401);
      expect(rejeu.cookies.size).toBe(0);

      const autreCeremonie = fakeReply();
      await auth.passkeyAuthenticationOptions(
        { challenge },
        REQUEST as never,
        autreCeremonie as never,
      );
      expect(autreCeremonie.statusCode).toBe(401);

      const ouvertes = await db.select().from(sessions).where(eq(sessions.userId, compte.id));
      expect(ouvertes).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  /**
   * NC-29 : la réussite ne se consigne qu'une fois toutes les preuves données
   * — c'est elle qui exempte l'adresse du verrou du compte. Le code TOTP la
   * consignait ; la clé d'accès, second facteur au même titre, l'oubliait :
   * son titulaire restait inconnu de son propre compte, et dix échecs d'un
   * tiers l'enfermaient dehors.
   */
  it("fait connaître l'adresse au compte quand la clé d'accès a ouvert la session", async () => {
    vi.stubEnv("PANEL_ORIGIN", "https://panel.gamedashboard.test");
    try {
      const compte = await compteAvecCodesDeSecours();
      const [titulaire] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, compte.id));
      const auth = await processus({
        authenticationOptions: async () => ({ challenge: "defi-webauthn" }),
        verifyAuthentication: async () => true,
      });

      const options = fakeReply();
      await auth.passkeyAuthenticationOptions(
        { challenge: issueChallenge("login", compte.id, { method: "password" }) },
        REQUEST as never,
        options as never,
      );
      const ceremonie = (options.body as { data: { challenge: string } }).data.challenge;
      const passkey = fakeReply();
      await auth.loginWithPasskey(
        { challenge: ceremonie, response: {} },
        REQUEST as never,
        passkey as never,
      );
      expect(passkey.statusCode).toBe(200);

      const reussites = await db
        .select({ ip: loginAttempts.ip })
        .from(loginAttempts)
        .where(
          and(eq(loginAttempts.email, titulaire?.email ?? ""), eq(loginAttempts.success, true)),
        );
      expect(reussites).toEqual([{ ip: REQUEST.ip }]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuse la clé d'accès quand le défi de connexion a déjà servi", async () => {
    vi.stubEnv("PANEL_ORIGIN", "https://panel.gamedashboard.test");
    try {
      const compte = await compteAvecCodesDeSecours();
      const challenge = issueChallenge("login", compte.id, { method: "password" });
      const auth = await processus({
        authenticationOptions: async () => ({ challenge: "defi-webauthn" }),
        verifyAuthentication: async () => true,
      });

      // La cérémonie est ouverte, puis le défi sert au code de secours.
      const options = fakeReply();
      await auth.passkeyAuthenticationOptions({ challenge }, REQUEST as never, options as never);
      const ceremonie = (options.body as { data: { challenge: string } }).data.challenge;

      const code = fakeReply();
      await auth.loginTwoFactor(
        { challenge, recoveryCode: compte.codes[0] },
        REQUEST as never,
        code as never,
      );
      expect(code.statusCode).toBe(200);

      const passkey = fakeReply();
      await auth.loginWithPasskey(
        { challenge: ceremonie, response: {} },
        REQUEST as never,
        passkey as never,
      );
      expect(passkey.statusCode).toBe(401);
      expect(passkey.cookies.size).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
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
