import { randomBytes } from "node:crypto";
import { encryptSecret, generateTotpSecret, totpCodeAt, totpStep } from "@gamedashboard/auth";
import {
  type Database,
  sessions as sessionsTable,
  users,
  userTotpCredentials,
} from "@gamedashboard/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { ActivityService } from "../activity/activity.service";
import type { PlatformSettingsService } from "../admin/platform-settings.service";
import { AuthController } from "./auth.controller";
import { AuthTokenRepository } from "./auth-token.repository";
import { BillingSsoService } from "./billing-sso.service";
import { readChallenge } from "./login-challenge";
import type { SecurityAlertService } from "./security-alert.service";
import { SessionRepository } from "./session.repository";
import { SessionIssuerService } from "./session-issuer.service";
import { TwoFactorRepository } from "./two-factor.repository";
import { UserRepository } from "./user.repository";

process.env.APP_SECRET_KEY ??= "clé de test des défis de connexion";

/**
 * L'arrivée par le lien de la facturation, de la route jusqu'à la session,
 * contre une vraie base.
 *
 * Le lien ouvrait la session sans demander le second facteur du panel, alors
 * que le mot de passe, l'annuaire et Google le demandent tous (NC-05). Le
 * facturier atteste une identité ; il ne prouve pas la possession de la clé
 * que le titulaire a enregistrée ici. Quiconque tenait l'espace client — ou
 * une clé applicative — entrait donc dans un compte protégé comme dans un
 * compte qui ne l'est pas.
 */

function fakeReply() {
  const reply = {
    statusCode: 200,
    body: undefined as unknown,
    cookies: new Map<string, string>(),
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    header() {
      return reply;
    },
    setCookie(name: string, value: string) {
      reply.cookies.set(name, value);
      return reply;
    },
    clearCookie() {
      return reply;
    },
    send(body: unknown) {
      reply.body = body;
    },
  };
  return reply;
}

const requete = {
  ip: "203.0.113.7",
  headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0" },
  socket: { remoteAddress: "127.0.0.1" },
};

describe.skipIf(!HAS_DATABASE)("connexion par le lien de la facturation (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let controller: AuthController;
  let billing: BillingSsoService;

  beforeAll(async () => {
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;

    const reglages = { text: async () => "panel.test" } as unknown as PlatformSettingsService;
    const tokens = new AuthTokenRepository(db);
    const usersRepo = new UserRepository(db);
    const sessions = new SessionRepository(db);
    billing = new BillingSsoService(db, tokens, reglages);

    controller = new AuthController(
      usersRepo,
      sessions,
      new ActivityService(db),
      new TwoFactorRepository(db),
      {} as never,
      {} as never,
      {} as never,
      billing,
      new SessionIssuerService(sessions, usersRepo, {
        afterSignIn: () => undefined,
      } as unknown as SecurityAlertService),
      tokens,
      {} as never,
      reglages,
      {} as never,
      {} as never,
      { afterFailure: () => undefined } as unknown as SecurityAlertService,
      {} as never,
    );
  }, 60_000);

  afterAll(async () => {
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(sql.raw("truncate table users, activity_logs cascade"));
  });

  async function client(): Promise<string> {
    const [row] = await db
      .insert(users)
      .values({
        email: `client-${randomBytes(4).toString("hex")}@gamedashboard.test`,
        nameFirst: "Camille",
        nameLast: "Martin",
        passwordHash: null,
      })
      .returning({ id: users.id });
    if (!row) throw new Error("compte non créé");
    return row.id;
  }

  /** Protège le compte par une application d'authentification ; rend son secret. */
  async function avecTotp(userId: string): Promise<string> {
    const secret = generateTotpSecret();
    await db.insert(userTotpCredentials).values({
      userId,
      secretEnc: encryptSecret(secret),
      verifiedAt: new Date().toISOString(),
    });
    return secret;
  }

  /** Suit le lien que le facturier aurait remis au client. */
  async function arrivee(userId: string) {
    const { url } = await billing.issue({ userId });
    const token = url.split("/sso/")[1];
    const reply = fakeReply();
    await controller.billingConsume({ token }, requete as never, reply as never);
    return reply;
  }

  const sessionsDe = (userId: string) =>
    db.select().from(sessionsTable).where(eq(sessionsTable.userId, userId));

  it("ouvre la session d'un compte sans second facteur", async () => {
    const id = await client();

    const reply = await arrivee(id);
    expect(reply.statusCode).toBe(200);
    expect(reply.cookies.size).toBe(1);
    const [session] = await sessionsDe(id);
    expect(session?.authMethod).toBe("billing_sso");
  });

  it("demande le second facteur d'un compte qui en a un, sans ouvrir de session", async () => {
    const id = await client();
    await avecTotp(id);

    const reply = await arrivee(id);
    expect(reply.statusCode).toBe(200);
    expect(reply.body).toMatchObject({
      twoFactorRequired: true,
      challenge: expect.any(String),
      methods: { totp: true, passkeys: false },
    });
    expect(reply.cookies.size).toBe(0);
    expect(await sessionsDe(id)).toEqual([]);
  });

  it("ouvre la session au second facteur, en la disant venue de la facturation", async () => {
    const id = await client();
    const secret = await avecTotp(id);

    const { challenge } = (await arrivee(id)).body as { challenge: string };
    // La session ouverte après le code doit dire par où l'on est entré : la
    // liste des sessions et le journal le montrent au titulaire.
    expect(readChallenge("login", challenge)?.method).toBe("billing_sso");

    const reply = fakeReply();
    await controller.loginTwoFactor(
      { challenge, code: totpCodeAt(secret, totpStep()) },
      requete as never,
      reply as never,
    );
    expect(reply.statusCode).toBe(200);
    expect(reply.cookies.size).toBe(1);
    const [session] = await sessionsDe(id);
    expect(session?.authMethod).toBe("billing_sso");
  });
});
