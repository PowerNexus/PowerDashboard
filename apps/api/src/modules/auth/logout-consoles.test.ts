import { describe, expect, it, vi } from "vitest";
import { AuthController } from "./auth.controller";
import type { SessionUser } from "./session.repository";

/**
 * Une session qui se ferme ferme ses consoles (NC-43).
 *
 * Le jeton d'une console est signé, autonome, valable dix minutes, et Wings
 * ne revérifie rien en cours de route : la déconnexion révoquait la session
 * en base, et la console restait ouverte — lecture **et commandes** — jusqu'à
 * l'expiration du jeton. Le daemon est prévenu par `ws/deny`, comme pour une
 * suspension ou un retrait d'accès.
 */

const CLIENT: SessionUser = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  email: "client@gamedashboard.test",
  nameFirst: "Alex",
  nameLast: "Client",
  role: "client",
  locale: "fr",
  timezone: "Europe/Paris",
  avatarUrl: null,
  emailVerifiedAt: null,
  authMethod: "impersonation",
  impersonator: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "agent@gamedashboard.test" },
};

function fakeReply() {
  const reply = {
    statusCode: 200,
    setCookie: () => reply,
    clearCookie: () => reply,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    header: () => reply,
    send() {},
  };
  return reply;
}

function controller() {
  const revocableForSession = vi.fn(
    () =>
      new Map([
        ["serveur-sur-un-node-injoignable", ["j1", "j2"]],
        ["serveur-joignable", ["j3"]],
      ]),
  );
  const denyWebsocketTokens = vi.fn(async (serverId: string) => {
    if (serverId === "serveur-sur-un-node-injoignable") throw new Error("node injoignable");
  });
  const revoke = vi.fn(async () => undefined);

  const args: unknown[] = Array.from({ length: 18 }, () => ({}));
  args[1] = { revoke, resolve: async () => null };
  args[2] = { record: async () => undefined };
  args[16] = { revocableForSession };
  args[17] = { denyWebsocketTokens };
  const auth = new (AuthController as unknown as new (...a: unknown[]) => AuthController)(...args);
  return { auth, revoke, revocableForSession, denyWebsocketTokens };
}

describe("fin de session et consoles ouvertes", () => {
  it("la déconnexion révoque les jetons de console de cette session", async () => {
    const { auth, revoke, revocableForSession, denyWebsocketTokens } = controller();
    const reply = fakeReply();

    await auth.logout({ sessionToken: "jeton-de-session", headers: {} } as never, reply as never);

    expect(revoke).toHaveBeenCalledWith("jeton-de-session");
    expect(revocableForSession).toHaveBeenCalledWith("jeton-de-session");
    expect(denyWebsocketTokens).toHaveBeenCalledWith("serveur-sur-un-node-injoignable", [
      "j1",
      "j2",
    ]);
    expect(denyWebsocketTokens).toHaveBeenCalledWith("serveur-joignable", ["j3"]);
    // Un node injoignable n'empêche pas de partir : la session est fermée en
    // base, et le jeton expirera de lui-même.
    expect(reply.statusCode).toBe(204);
  });

  it("la fin d'une prise en main ferme aussi les consoles qu'elle a ouvertes", async () => {
    const { auth, revocableForSession, denyWebsocketTokens } = controller();

    await auth.stopImpersonation(
      { user: CLIENT, sessionToken: "jeton-emprunte", headers: {} } as never,
      fakeReply() as never,
    );

    expect(revocableForSession).toHaveBeenCalledWith("jeton-emprunte");
    expect(denyWebsocketTokens).toHaveBeenCalledWith("serveur-joignable", ["j3"]);
  });
});
