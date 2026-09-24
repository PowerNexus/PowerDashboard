import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminController } from "../admin/admin.controller";
import { AuthController } from "./auth.controller";
import type { SessionUser } from "./session.repository";

/**
 * Le cookie de retour d'une prise en main porte `__Host-` comme la session
 * (NC-25).
 *
 * Il contient le **jeton de session de l'agent** pendant qu'il regarde le
 * compte d'un client : sans le préfixe, un sous-domaine — un domaine
 * revendeur — pouvait poser un `gd_return` du même nom, envoyé à sa place.
 * Les deux bouts sont vérifiés : la pose (administration) et la relecture au
 * retour (authentification), qui doivent s'accorder sur le nom.
 */

const STAFF: SessionUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  email: "agent@gamedashboard.test",
  nameFirst: "Agent",
  nameLast: "Support",
  role: "admin",
  locale: "fr",
  timezone: "Europe/Paris",
  avatarUrl: null,
  emailVerifiedAt: null,
  authMethod: "password",
  impersonator: null,
};

const CLIENT: SessionUser = {
  ...STAFF,
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  email: "client@gamedashboard.test",
  role: "client",
  authMethod: "impersonation",
  impersonator: { id: STAFF.id, email: STAFF.email },
};

function fakeReply() {
  const reply = {
    statusCode: 200,
    set: new Map<string, { value: string; options: Record<string, unknown> }>(),
    cleared: new Map<string, Record<string, unknown> | undefined>(),
    setCookie(name: string, value: string, options: Record<string, unknown>) {
      reply.set.set(name, { value, options });
      return reply;
    },
    clearCookie(name: string, options?: Record<string, unknown>) {
      reply.cleared.set(name, options);
      return reply;
    },
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    header() {
      return reply;
    },
    send() {},
  };
  return reply;
}

describe("cookie de retour d'une prise en main", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("est posé sous __Host- en production, avec les attributs de la session", async () => {
    const args: unknown[] = Array.from({ length: 21 }, () => ({}));
    args[2] = { impersonationTarget: async () => ({ id: CLIENT.id, email: CLIENT.email }) };
    args[8] = { record: async () => undefined };
    args[17] = { create: async () => "jeton-du-client" };
    const admin = new (AdminController as unknown as new (...a: unknown[]) => AdminController)(
      ...args,
    );

    const reply = fakeReply();
    await admin.impersonate(
      { user: STAFF, sessionToken: "jeton-de-l-agent", headers: {} } as never,
      CLIENT.id,
      reply as never,
    );

    expect([...reply.set.keys()].sort()).toEqual(["__Host-gd_return", "__Host-gd_session"]);
    expect(reply.set.get("__Host-gd_return")).toMatchObject({
      value: "jeton-de-l-agent",
      options: { path: "/", httpOnly: true, sameSite: "lax", secure: true },
    });
  });

  it("est relu sous le même nom au retour, et rend la session de l'agent", async () => {
    const resolve = vi.fn(async (token: string) => (token === "jeton-de-l-agent" ? STAFF : null));
    const args: unknown[] = Array.from({ length: 18 }, () => ({}));
    args[1] = { revoke: async () => undefined, resolve };
    args[2] = { record: async () => undefined };
    args[16] = { revocableForSession: () => new Map() };
    const auth = new (AuthController as unknown as new (...a: unknown[]) => AuthController)(
      ...args,
    );

    const reply = fakeReply();
    await auth.stopImpersonation(
      {
        user: CLIENT,
        sessionToken: "jeton-du-client",
        headers: { cookie: "__Host-gd_session=jeton-du-client; __Host-gd_return=jeton-de-l-agent" },
      } as never,
      reply as never,
    );

    expect(resolve).toHaveBeenCalledWith("jeton-de-l-agent");
    expect(reply.set.get("__Host-gd_session")?.value).toBe("jeton-de-l-agent");
    expect(reply.cleared.get("__Host-gd_return")).toMatchObject({ secure: true, path: "/" });
  });
});
