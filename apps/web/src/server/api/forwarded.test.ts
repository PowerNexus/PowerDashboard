import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ce que Next transmet à l'API de la requête du navigateur (NC-02).
 *
 * Le navigateur ne parle qu'à Next : ses en-têtes `Origin` et
 * `Sec-Fetch-Site` s'arrêtaient là, et l'API ne pouvait pas savoir qu'une
 * écriture venait d'un autre site. Next les transmet désormais sous des noms
 * à lui, que `SessionGuard` lit.
 */

let entrants = new Headers();
vi.mock("next/headers", () => ({ headers: async () => entrants }));

const { forwardedIdentityHeaders } = await import("./forwarded");

describe("forwardedIdentityHeaders", () => {
  beforeEach(() => {
    entrants = new Headers();
  });

  it("transmet l'origine et la relation déclarées par le navigateur", async () => {
    entrants = new Headers({
      host: "panel.example.fr",
      origin: "https://panel.example.fr",
      "sec-fetch-site": "same-origin",
    });
    const transmis = await forwardedIdentityHeaders();

    expect(transmis["x-gd-origin"]).toBe("https://panel.example.fr");
    expect(transmis["x-gd-fetch-site"]).toBe("same-origin");
    expect(transmis["x-gd-host"]).toBe("panel.example.fr");
  });

  it("transmet aussi ce qui accuse, pour que l'API refuse", async () => {
    entrants = new Headers({ origin: "https://evil.example", "sec-fetch-site": "cross-site" });
    const transmis = await forwardedIdentityHeaders();

    expect(transmis["x-gd-origin"]).toBe("https://evil.example");
    expect(transmis["x-gd-fetch-site"]).toBe("cross-site");
  });

  it("n'invente rien quand le navigateur n'a rien dit", async () => {
    // Rendu d'une page en GET : pas d'`Origin`. L'absence doit rester une
    // absence, que l'API lit comme « pas un navigateur qu'on abuse ».
    const transmis = await forwardedIdentityHeaders();
    expect(transmis).not.toHaveProperty("x-gd-origin");
    expect(transmis).not.toHaveProperty("x-gd-fetch-site");
  });
});
