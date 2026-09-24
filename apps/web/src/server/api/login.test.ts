import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { consumeBillingLink } from "@/server/api/login";

/**
 * L'arrivée par le lien de la facturation, côté web.
 *
 * L'API demande désormais le second facteur du panel sur ce chemin (NC-05).
 * La couche web doit alors présenter le défi, et **rien d'autre** : ni cookie
 * de session, ni redirection vers l'accueil, qui renverrait vers la connexion
 * sans rien expliquer — ou pire, laisserait croire que le lien a suffi.
 */

const posés = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (nom: string, valeur: string) => posés.set(nom, valeur),
  }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));

describe("consommation du lien de la facturation", () => {
  beforeEach(() => {
    posés.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rend le défi du second facteur, sans poser de session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          twoFactorRequired: true,
          challenge: "defi-scelle",
          methods: { totp: true, passkeys: false },
          remainingRecoveryCodes: 7,
        }),
      ),
    );

    await expect(consumeBillingLink("jeton-de-la-facturation")).resolves.toEqual({
      error: null,
      secondFactor: {
        error: null,
        challenge: "defi-scelle",
        methods: { totp: true, passkeys: false },
        remainingRecoveryCodes: 7,
      },
    });
    expect(posés.size).toBe(0);
  });

  it("pose la session quand le compte n'a pas de second facteur", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { user: { locale: "fr" } },
          { headers: { "set-cookie": `${SESSION_COOKIE}=jeton-de-session; Path=/; HttpOnly` } },
        ),
      ),
    );

    await expect(consumeBillingLink("jeton-de-la-facturation")).resolves.toEqual({
      error: null,
      secondFactor: null,
    });
    expect(posés.get(SESSION_COOKIE)).toBe("jeton-de-session");
  });
});
