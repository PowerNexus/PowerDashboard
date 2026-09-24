import {
  activityLogs,
  type Database,
  sessions as sessionsTable,
  userOauthAccounts,
  users,
} from "@gamedashboard/db";
import { Logger } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { ActivityService } from "../activity/activity.service";
import type { PlatformSettingsService, SsoConfiguration } from "../admin/platform-settings.service";
import { AuthController } from "./auth.controller";
import type { SecurityAlertService } from "./security-alert.service";
import { SessionRepository } from "./session.repository";
import { SessionIssuerService } from "./session-issuer.service";
import { SsoService } from "./sso.service";
import { TwoFactorRepository } from "./two-factor.repository";
import { UserRepository } from "./user.repository";

/**
 * Le bouton « Se connecter avec Google » (PLAN §12.4, décision 4), de la
 * route jusqu'à la session, contre une vraie base.
 *
 * Seul Google est simulé : ses deux adresses répondent ce qu'il répondrait.
 * Ce qui compte se joue en base — liaison, création, moyen d'entrée de la
 * session — et une doublure n'éprouverait que son accord avec elle-même.
 */

const PANEL = "https://panel.gamedashboard.test";
const RETOUR = `${PANEL}/auth/google/callback`;
const ANNUAIRE: SsoConfiguration = {
  label: "Annuaire",
  authorizeUrl: "https://annuaire.test/authorize",
  tokenUrl: "https://annuaire.test/token",
  userinfoUrl: "https://annuaire.test/userinfo",
  clientId: "annuaire",
  clientSecret: "secret",
  scopes: "openid email profile",
};

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

describe.skipIf(!HAS_DATABASE)("Connexion avec Google (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let controller: AuthController;
  let annuaire: SsoConfiguration | null;
  let inscriptionsOuvertes: boolean;
  let profilGoogle: Record<string, unknown>;
  const panelAvant = process.env.PANEL_ORIGIN;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    process.env.PANEL_ORIGIN = PANEL;
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
  }, 60_000);

  afterAll(async () => {
    process.env.PANEL_ORIGIN = panelAvant;
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(sql.raw("truncate table users, activity_logs cascade"));
    annuaire = null;
    inscriptionsOuvertes = false;
    profilGoogle = {
      sub: "109876543210",
      email: "alex@gmail.com",
      email_verified: true,
      given_name: "Alex",
      family_name: "Martin",
    };

    // Google, et lui seul : l'échange du code, puis le profil.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (adresse: string | URL) => {
        const url = String(adresse);
        if (url === "https://oauth2.googleapis.com/token") {
          return Response.json({ access_token: "jeton-google", token_type: "Bearer" });
        }
        if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
          return Response.json(profilGoogle);
        }
        return new Response("inattendu", { status: 500 });
      }),
    );

    const reglages = {
      ssoConfiguration: async () => annuaire,
      googleConfiguration: async () => ({
        clientId: "client.apps.googleusercontent.com",
        clientSecret: "s",
      }),
      boolean: async (cle: string) => cle === "security.registrationOpen" && inscriptionsOuvertes,
      text: async () => "gamedashboard.local",
    } as unknown as PlatformSettingsService;

    const usersRepo = new UserRepository(db);
    const sessions = new SessionRepository(db);
    const issuer = new SessionIssuerService(sessions, usersRepo, {
      afterSignIn: () => undefined,
    } as unknown as SecurityAlertService);

    controller = new AuthController(
      usersRepo,
      sessions,
      new ActivityService(db),
      new TwoFactorRepository(db),
      {} as never,
      {} as never,
      new SsoService(db, reglages),
      {} as never,
      issuer,
      {} as never,
      {} as never,
      reglages,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function retour() {
    const reply = fakeReply();
    await controller.googleCallback(
      { code: "code-google", codeVerifier: "verificateur", redirectUri: RETOUR },
      requete as never,
      reply as never,
    );
    return reply;
  }

  async function compte(email: string) {
    const [row] = await db
      .insert(users)
      .values({ email, nameFirst: "Alex", nameLast: "Martin", passwordHash: null })
      .returning({ id: users.id });
    if (!row) throw new Error("compte non créé");
    return row.id;
  }

  it("part chez Google avec PKCE, et laisse choisir le compte", async () => {
    const reply = fakeReply();
    await controller.googleStart({ redirectUri: RETOUR }, reply as never);

    expect(reply.statusCode).toBe(200);
    const { url } = (reply.body as { data: { url: string } }).data;
    const adresse = new URL(url);
    expect(`${adresse.origin}${adresse.pathname}`).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(adresse.searchParams.get("redirect_uri")).toBe(RETOUR);
    expect(adresse.searchParams.get("scope")).toBe("openid email profile");
    expect(adresse.searchParams.get("code_challenge_method")).toBe("S256");
    expect(adresse.searchParams.get("prompt")).toBe("select_account");
  });

  it("entre dans le compte qui porte l'adresse vérifiée, et le lie", async () => {
    const id = await compte("alex@gmail.com");

    const reply = await retour();
    expect(reply.statusCode).toBe(200);
    expect(reply.cookies.size).toBe(1);

    const [liaison] = await db
      .select()
      .from(userOauthAccounts)
      .where(eq(userOauthAccounts.userId, id));
    expect(liaison?.provider).toBe("google");
    expect(liaison?.providerUserId).toBe("109876543210");

    const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.userId, id));
    expect(session?.authMethod).toBe("google");
    const [trace] = await db.select().from(activityLogs).where(eq(activityLogs.actorId, id));
    expect(trace?.event).toBe("account.google_login");
  });

  it("ne crée aucun compte quand les inscriptions sont fermées", async () => {
    const reply = await retour();

    expect(reply.statusCode).toBe(409);
    expect(reply.body).toMatchObject({ noAccount: true });
    expect(await db.select().from(users)).toEqual([]);
  });

  it("crée le compte quand les inscriptions sont ouvertes", async () => {
    inscriptionsOuvertes = true;

    const reply = await retour();
    expect(reply.statusCode).toBe(200);

    const [cree] = await db.select().from(users).where(eq(users.email, "alex@gmail.com"));
    expect(cree?.passwordHash).toBeNull();
    expect(cree?.emailVerifiedAt).not.toBeNull();
    const [trace] = await db
      .select()
      .from(activityLogs)
      .where(eq(activityLogs.actorId, cree?.id ?? ""));
    expect(trace?.event).toBe("account.google_created");
  });

  it("ne rapproche pas une adresse que Google n'a pas vérifiée", async () => {
    await compte("alex@gmail.com");
    profilGoogle.email_verified = false;
    inscriptionsOuvertes = true;

    const reply = await retour();
    expect(reply.statusCode).toBe(409);
    expect(await db.select().from(userOauthAccounts)).toEqual([]);
  });

  it("s'efface quand l'annuaire est obligatoire : il est alors le seul chemin", async () => {
    annuaire = ANNUAIRE;
    await compte("alex@gmail.com");

    expect(await controller.googleStatus()).toEqual({ data: { enabled: false } });

    const depart = fakeReply();
    await controller.googleStart({ redirectUri: RETOUR }, depart as never);
    expect(depart.statusCode).toBe(409);

    const reply = await retour();
    expect(reply.statusCode).toBe(409);
    expect(reply.cookies.size).toBe(0);
  });
});
