import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Relais du jeton de console : même contrôle d'origine que l'API (NC-02).
 *
 * Il comparait l'origine à `PANEL_ORIGIN` seule : une console ouverte depuis
 * le domaine d'un revendeur, qui sert le même panel, était refusée. Il
 * applique désormais la règle partagée (`@gamedashboard/contracts`), qui
 * admet aussi l'hôte d'arrivée.
 */

let entrants = new Headers();
vi.mock("next/headers", () => ({
  headers: async () => entrants,
  cookies: async () => ({
    get: (nom: string) => (nom === "gd_session" ? { value: "jeton-de-session" } : undefined),
  }),
}));

// Posée avant l'import, comme en production où elle précède le démarrage.
vi.stubEnv("PANEL_ORIGIN", "https://panel.example.fr");
const { POST } = await import("./route");

const parametres = { params: Promise.resolve({ id: "s-1" }) };

function demande(entetes: Record<string, string>): Request {
  entrants = new Headers({ host: "panel.example.fr", ...entetes });
  return new Request("https://panel.example.fr/api/servers/s-1/websocket", {
    method: "POST",
    headers: entrants,
  });
}

describe("POST /api/servers/[id]/websocket", () => {
  const amont = vi.fn(async (..._args: unknown[]) =>
    Response.json({ data: { token: "t", socket: "wss://node" } }),
  );

  beforeEach(() => {
    vi.stubEnv("PANEL_ORIGIN", "https://panel.example.fr");
    vi.stubGlobal("fetch", amont);
  });
  afterEach(() => {
    amont.mockClear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("refuse un jeton de console demandé par un autre site", async () => {
    for (const entetes of [
      { "sec-fetch-site": "cross-site" },
      { origin: "https://evil.example" },
    ] as Record<string, string>[]) {
      const reponse = await POST(demande(entetes), parametres);
      expect(reponse.status, JSON.stringify(entetes)).toBe(403);
    }
    expect(amont).not.toHaveBeenCalled();
  });

  it("délivre le jeton au panel", async () => {
    const reponse = await POST(
      demande({ origin: "https://panel.example.fr", "sec-fetch-site": "same-origin" }),
      parametres,
    );
    expect(reponse.status).toBe(200);
  });

  it("délivre le jeton au domaine d'un revendeur", async () => {
    const reponse = await POST(
      demande({
        host: "panel.revendeur.fr",
        origin: "https://panel.revendeur.fr",
        "sec-fetch-site": "same-origin",
      }),
      parametres,
    );
    expect(reponse.status).toBe(200);
  });
});
