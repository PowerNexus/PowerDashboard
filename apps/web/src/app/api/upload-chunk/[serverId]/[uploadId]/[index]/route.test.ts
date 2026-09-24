import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Relais d'un morceau d'envoi : contrôle d'origine (NC-02, ASVS 4.2.2).
 *
 * Le défaut : ce relais n'est pas une action serveur de Next, il n'hérite donc
 * pas de son contrôle d'origine — et il n'en faisait aucun, contrairement au
 * relais du WebSocket. Un site tiers pouvait faire écrire un morceau dans
 * l'envoi en cours d'un visiteur connecté, `SameSite=Lax` mis à part.
 */

let entrants = new Headers();
vi.mock("next/headers", () => ({
  headers: async () => entrants,
  cookies: async () => ({
    get: (nom: string) => (nom === "gd_session" ? { value: "jeton-de-session" } : undefined),
  }),
}));

const { POST } = await import("./route");

const parametres = {
  params: Promise.resolve({ serverId: "s-1", uploadId: "u-1", index: "0" }),
};

function morceau(entetes: Record<string, string>): Request {
  entrants = new Headers({ host: "panel.example.fr", "content-length": "4", ...entetes });
  return new Request("https://panel.example.fr/api/upload-chunk/s-1/u-1/0", {
    method: "POST",
    headers: entrants,
    body: "abcd",
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("POST /api/upload-chunk/…", () => {
  const amont = vi.fn(async (..._args: unknown[]) => Response.json({ received: 4 }));

  beforeEach(() => {
    vi.stubEnv("PANEL_ORIGIN", "https://panel.example.fr");
    vi.stubGlobal("fetch", amont);
  });
  afterEach(() => {
    amont.mockClear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuse un morceau qu'un autre site fait envoyer", async () => {
    const reponse = await POST(morceau({ "sec-fetch-site": "cross-site" }), parametres);
    expect(reponse.status).toBe(403);
    expect(amont).not.toHaveBeenCalled();
  });

  it("refuse une origine étrangère", async () => {
    const reponse = await POST(morceau({ origin: "https://evil.example" }), parametres);
    expect(reponse.status).toBe(403);
    expect(amont).not.toHaveBeenCalled();
  });

  it("relaie un morceau envoyé par le panel, et dit à l'API d'où il vient", async () => {
    const reponse = await POST(
      morceau({ origin: "https://panel.example.fr", "sec-fetch-site": "same-origin" }),
      parametres,
    );
    expect(reponse.status).toBe(200);
    expect(amont).toHaveBeenCalledOnce();
    const init = amont.mock.calls[0]?.[1] as RequestInit;
    const transmis = init.headers as Record<string, string>;
    expect(transmis["x-gd-origin"]).toBe("https://panel.example.fr");
    expect(transmis["x-gd-fetch-site"]).toBe("same-origin");
  });

  it("relaie un morceau envoyé depuis le domaine d'un revendeur", async () => {
    const requete = morceau({
      host: "panel.revendeur.fr",
      origin: "https://panel.revendeur.fr",
      "sec-fetch-site": "same-origin",
    });
    const reponse = await POST(requete, parametres);
    expect(reponse.status).toBe(200);
  });
});
