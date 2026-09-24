import { hashPassword } from "@gamedashboard/auth";
import { activityLogs, type Database, loginAttempts, users } from "@gamedashboard/db";
import { Logger } from "@nestjs/common";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createThrowawayDatabase,
  HAS_DATABASE,
  NO_DATABASE_REASON,
  type ThrowawayDatabase,
} from "../../test/throwaway-database";
import { ActivityService } from "../activity/activity.service";
import type { PlatformSettingsService } from "../admin/platform-settings.service";
import type { MailerService } from "../mail/mailer.service";
import { NotificationPreferencesRepository } from "../notifications/notification-preferences.repository";
import { NotificationsService } from "../notifications/notifications.service";
import type { BrandingService } from "../reseller/branding.service";
import type { ClientWebhookEmitterService } from "../webhooks/client-webhook-emitter.service";
import { AuthController } from "./auth.controller";
import { AuthTokenRepository } from "./auth-token.repository";
import { SecurityAlertRepository } from "./security-alert.repository";
import { SecurityAlertService } from "./security-alert.service";
import { SessionRepository } from "./session.repository";
import { SessionIssuerService } from "./session-issuer.service";
import { TwoFactorRepository } from "./two-factor.repository";
import { UserRepository } from "./user.repository";

/**
 * Ce qui arrive autour d'un authentifiant : son changement, les liens qui
 * l'entourent, les échecs qu'il provoque.
 *
 * Contre une vraie base, comme les alertes de sécurité : les décisions vivent
 * dans des prédicats SQL (jetons « non consommés », échecs « dans la
 * fenêtre »), et une doublure n'éprouverait que son accord avec elle-même.
 * Seuls le transport SMTP, le captcha, la marque et HaveIBeenPwned sont
 * simulés : ils ne décident de rien ici.
 */

const PASSWORD = "cheval-agrafe-batterie-correcte";
const NEW_PASSWORD = "lanterne-fougere-horizon-tiede";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0";

/** Réponse Fastify réduite à ce que le contrôleur emploie. */
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

interface Account {
  id: string;
  email: string;
  role: string;
}

describe.skipIf(!HAS_DATABASE)("Authentifiants (intégration)", () => {
  let throwaway: ThrowawayDatabase;
  let db: Database;
  let digest: string;
  let mail: { send: ReturnType<typeof vi.fn>; isConfigured: () => Promise<boolean> };
  let tokens: AuthTokenRepository;
  let alerts: SecurityAlertService;
  let controller: AuthController;
  /** Réglages booléens de la plateforme ; absents, ils valent faux. */
  let settings: Record<string, boolean>;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    throwaway = await createThrowawayDatabase();
    db = throwaway.db;
    digest = await hashPassword(PASSWORD);
    // HaveIBeenPwned : aucune fuite connue, et surtout aucun appel réseau.
    vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, text: async () => "" }));
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await throwaway?.drop();
  });

  beforeEach(async () => {
    await db.execute(
      sql.raw("truncate table users, login_attempts, activity_logs, auth_tokens cascade"),
    );

    mail = { send: vi.fn(async () => true), isConfigured: async () => true };
    settings = {};
    const mailer = mail as unknown as MailerService;
    const branding = {
      forHost: async () => ({ name: "GameDashboard", resellerId: null }),
    } as unknown as BrandingService;
    const platform = {
      text: async () => "gamedashboard.local",
      boolean: async (key: string) => settings[key] ?? false,
    } as unknown as PlatformSettingsService;

    const userRepository = new UserRepository(db);
    const sessions = new SessionRepository(db);
    const activity = new ActivityService(db);
    tokens = new AuthTokenRepository(db);
    alerts = new SecurityAlertService(
      new SecurityAlertRepository(db),
      new NotificationsService(db, new NotificationPreferencesRepository(db), mailer, {
        emit: async () => {},
      } as unknown as ClientWebhookEmitterService),
      mailer,
      activity,
      branding,
      platform,
    );

    controller = new AuthController(
      userRepository,
      sessions,
      activity,
      new TwoFactorRepository(db),
      {} as never,
      {} as never,
      { configuration: async () => null } as never,
      {} as never,
      new SessionIssuerService(sessions, userRepository, alerts),
      tokens,
      mailer,
      platform,
      {} as never,
      { accepts: async () => true } as never,
      alerts,
      {} as never,
    );
  });

  async function seedAccount(role: "user" | "admin" | "reseller" = "user"): Promise<Account> {
    const email = `titulaire-${Math.random().toString(16).slice(2, 8)}@gamedashboard.test`;
    const [row] = await db
      .insert(users)
      .values({
        email,
        nameFirst: "Alex",
        nameLast: "Titulaire",
        passwordHash: digest,
        role,
        locale: "fr",
        timezone: "Europe/Paris",
        emailVerifiedAt: new Date().toISOString(),
      })
      .returning({ id: users.id, email: users.email, role: users.role });
    if (!row) throw new Error("compte non créé");
    return row;
  }

  /** Requête d'une session déjà ouverte sur ce compte, telle que la garde la pose. */
  function signedIn(account: Account, ip = "203.0.113.7") {
    return {
      ip,
      headers: { "user-agent": FIREFOX },
      socket: { remoteAddress: "127.0.0.1" },
      user: {
        id: account.id,
        email: account.email,
        nameFirst: "Alex",
        nameLast: "Titulaire",
        role: account.role,
        locale: "fr",
        timezone: "Europe/Paris",
        avatarUrl: null,
        emailVerifiedAt: new Date().toISOString(),
        authMethod: "password",
        impersonatorId: null,
      },
    } as never;
  }

  /** Connexion par mot de passe, depuis une adresse donnée. */
  async function login(email: string, password: string, ip = "203.0.113.7") {
    const reply = fakeReply();
    await controller.login(
      { email, password },
      { ip, headers: { "user-agent": FIREFOX }, socket: { remoteAddress: "127.0.0.1" } } as never,
      reply as never,
    );
    return reply;
  }

  /**
   * Échecs posés directement en base : les rejouer par la route coûterait le
   * délai progressif, jusqu'à cinq secondes par tentative.
   */
  async function seedFailures(email: string, ip: string, count: number): Promise<void> {
    const at = new Date().toISOString();
    await db
      .insert(loginAttempts)
      .values(Array.from({ length: count }, () => ({ email, ip, success: false, at })));
  }

  /** Le journal d'audit, dans l'ordre d'écriture. */
  async function journal() {
    return await db
      .select({
        event: activityLogs.event,
        actorId: activityLogs.actorId,
        actorLabel: activityLogs.actorLabel,
        ip: activityLogs.ip,
        properties: activityLogs.properties,
      })
      .from(activityLogs)
      .orderBy(asc(activityLogs.at));
  }

  describe("changement de mot de passe", () => {
    it("éteint les liens de réinitialisation encore valables", async () => {
      const account = await seedAccount();
      const issued = await tokens.issue(account.id, "password_reset", null);
      if (!issued) throw new Error("jeton non émis");

      const reply = fakeReply();
      await controller.changePassword(
        { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
        signedIn(account),
        reply as never,
      );
      expect(reply.statusCode).toBe(200);

      // Le lien parti avant le changement ne doit pas rouvrir le compte : on
      // change son mot de passe parce qu'on le croit connu d'un autre, et ce
      // lien dort peut-être dans une boîte que cet autre lit aussi.
      expect(await tokens.consume(issued.token, "password_reset")).toBeNull();
    });
  });

  describe("indicateur « double authentification requise »", () => {
    it("couvre le revendeur, que le garde du personnel retient aussi", async () => {
      settings["security.staffRequires2fa"] = true;

      // L'espace revendeur passe par `StaffTwoFactorGuard` : un indicateur
      // faux laissait l'écran muet devant un refus qu'il devait annoncer.
      const reseller = await seedAccount("reseller");
      expect((await controller.twoFactorStatus(signedIn(reseller))).data.required).toBe(true);

      const admin = await seedAccount("admin");
      expect((await controller.twoFactorStatus(signedIn(admin))).data.required).toBe(true);

      const client = await seedAccount("user");
      expect((await controller.twoFactorStatus(signedIn(client))).data.required).toBe(false);
    });
  });

  describe("journal d'audit des échecs", () => {
    it("consigne l'échec sur le compte visé, sans le secret essayé", async () => {
      const account = await seedAccount();
      const reply = await login(account.email, "pas-le-bon-mot-de-passe", "198.51.100.4");
      expect(reply.statusCode).toBe(401);
      await alerts.settled();

      const rows = (await journal()).filter((row) => row.event === "account.login_failed");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorId: account.id,
        actorLabel: account.email,
        ip: "198.51.100.4",
        properties: { stage: "password" },
      });
      expect(JSON.stringify(rows)).not.toContain("pas-le-bon-mot-de-passe");
    });

    it("ne consigne rien pour une adresse inconnue : l'identifiant saisi peut être un secret", async () => {
      // Un mot de passe tapé dans le champ de l'adresse est une erreur
      // ordinaire ; le journal, lu par tout le personnel, ne doit pas le garder.
      await login("cheval-agrafe@inconnu.test", "faux");
      await alerts.settled();
      expect(await journal()).toEqual([]);
    });

    it("consigne le verrouillage une fois, au franchissement du seuil", async () => {
      const account = await seedAccount();
      await seedFailures(account.email, "198.51.100.4", 9);

      expect((await login(account.email, "faux", "198.51.100.4")).statusCode).toBe(401);
      await alerts.settled();
      // Verrouillé : la tentative suivante n'est ni vérifiée ni comptée.
      expect((await login(account.email, "faux", "198.51.100.4")).statusCode).toBe(429);
      await alerts.settled();

      const locked = (await journal()).filter((row) => row.event === "account.locked");
      expect(locked).toHaveLength(1);
      expect(locked[0]).toMatchObject({
        actorId: account.id,
        ip: "198.51.100.4",
        properties: { failures: 10 },
      });
    }, 30_000);
  });
});

// Vitest n'affiche pas la raison d'un `skipIf` : on la dit une fois.
if (!HAS_DATABASE) console.info(NO_DATABASE_REASON);
