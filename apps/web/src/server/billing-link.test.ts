import { LOCALE_COOKIE } from "@gamedashboard/i18n";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/(auth)/sso/[token]/route";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { SSO_CHALLENGE_COOKIE } from "@/server/api/sso";

/**
 * L'arrivée par le lien de la facturation, côté web.
 *
 * Le défaut corrigé : c'était une **page**, qui posait le cookie de session
 * pendant son rendu. Next l'interdit (« Cookies can only be modified in a
 * Server Action or Route Handler ») : chaque arrivée sans second facteur
 * finissait en erreur 500, jeton consommé et session ouverte côté API, jamais
 * remise au navigateur. C'est désormais une route de navigation, jouée ici
 * telle que Next l'appelle.
 *
 * L'API est simulée : ce qui compte est ce que la réponse pose chez le
 * navigateur.
 */

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));

const PANEL = "https://panel.gamedashboard.test";

function arrivee(jeton = "jeton-de-la-facturation") {
  return GET(new NextRequest(`${PANEL}/sso/${jeton}`), {
    params: Promise.resolve({ token: jeton }),
  });
}

function api(reponse: Response) {
  const appel = vi.fn(async (_url: string, _init?: RequestInit) => reponse);
  vi.stubGlobal("fetch", appel);
  return appel;
}

function destination(reponse: Response): string {
  const url = new URL(reponse.headers.get("location") ?? "", PANEL);
  return `${url.pathname}${url.search}`;
}

describe("lien de la facturation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("remet la session au navigateur et emmène au panel quand le compte n'a pas de second facteur", async () => {
    const appel = api(
      Response.json(
        { user: { locale: "en" } },
        { headers: { "set-cookie": `${SESSION_COOKIE}=jeton-de-session; Path=/; HttpOnly` } },
      ),
    );

    const reponse = await arrivee();

    expect(appel.mock.calls[0]?.[0]).toMatch(/\/api\/v1\/auth\/billing\/consume$/);
    expect(JSON.parse(String(appel.mock.calls[0]?.[1]?.body))).toEqual({
      token: "jeton-de-la-facturation",
    });
    expect(destination(reponse)).toBe("/");
    const session = reponse.cookies.get(SESSION_COOKIE);
    expect(session?.value).toBe("jeton-de-session");
    expect(session).toMatchObject({ httpOnly: true, path: "/", sameSite: "lax" });
    expect(reponse.cookies.get(LOCALE_COOKIE)?.value).toBe("en");
  });

  it("mène au second facteur sur la page de connexion, sans session ni défi dans l'URL", async () => {
    api(
      Response.json({
        twoFactorRequired: true,
        challenge: "defi-scelle",
        methods: { totp: true, passkeys: false },
        remainingRecoveryCodes: 7,
      }),
    );

    const reponse = await arrivee();

    expect(destination(reponse)).toBe("/login?totp=1&recovery=7");
    expect(reponse.cookies.get(SSO_CHALLENGE_COOKIE)).toMatchObject({
      value: "defi-scelle",
      httpOnly: true,
      path: "/login",
    });
    expect(reponse.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("dit un lien mort sans rien poser", async () => {
    api(Response.json({ message: "Ce lien de connexion n'est plus valable." }, { status: 401 }));

    const reponse = await arrivee();

    expect(destination(reponse)).toBe("/sso?refus=expired");
    expect(reponse.cookies.getAll()).toEqual([]);
  });

  it("distingue le compte suspendu, qu'un nouveau lien ne rouvrirait pas", async () => {
    api(Response.json({ message: "Ce compte est suspendu." }, { status: 403 }));

    expect(destination(await arrivee())).toBe("/sso?refus=suspended");
  });

  it("n'échoue pas en page d'erreur quand l'API ne répond pas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    expect(destination(await arrivee())).toBe("/sso?refus=failed");
  });
});
