import { describe, expect, it } from "vitest";
import { foreignProvenance, hostOfOrigin } from "./browser-provenance";

/**
 * Provenance d'une requête écrite par cookie (NC-02, ASVS 4.2.2, 13.2.3).
 *
 * La règle que partagent l'API (`SessionGuard`) et les relais de Next
 * (WebSocket, envoi par morceaux) : une requête que le navigateur déclare
 * venue d'un autre site est refusée. Les hôtes du panel sont celui de
 * `PANEL_ORIGIN` et celui par lequel la requête est arrivée — un domaine de
 * revendeur sert le même panel.
 */
const PANEL = ["panel.example.fr", "panel.revendeur.fr"];

describe("foreignProvenance", () => {
  it("laisse passer ce que le panel envoie à lui-même", () => {
    expect(
      foreignProvenance({ origin: "https://panel.example.fr", fetchSite: "same-origin" }, PANEL),
    ).toBe(false);
  });

  it("laisse passer le domaine d'un revendeur, qui sert le même panel", () => {
    expect(
      foreignProvenance({ origin: "https://panel.revendeur.fr", fetchSite: "same-origin" }, PANEL),
    ).toBe(false);
  });

  it("laisse passer un client qui n'est pas un navigateur, faute de rien déclarer", () => {
    // curl, un script, Next lui-même : aucun en-tête d'origine. Pas de CSRF
    // possible sans navigateur pour joindre le cookie à l'insu de quelqu'un.
    expect(foreignProvenance({}, PANEL)).toBe(false);
    expect(foreignProvenance({ origin: null, fetchSite: null }, PANEL)).toBe(false);
  });

  it("refuse un autre site, dit par Sec-Fetch-Site", () => {
    expect(foreignProvenance({ fetchSite: "cross-site" }, PANEL)).toBe(true);
  });

  it("refuse un sous-domaine voisin, que SameSite=Lax laisse passer", () => {
    // `same-site` : même domaine enregistrable, autre hôte. Le cookie part,
    // mais ce n'est pas le panel qui écrit.
    expect(foreignProvenance({ fetchSite: "same-site" }, PANEL)).toBe(true);
  });

  it("laisse passer une navigation tapée au clavier", () => {
    expect(foreignProvenance({ fetchSite: "none" }, PANEL)).toBe(false);
  });

  it("refuse une origine étrangère, même sans Sec-Fetch-Site", () => {
    // Un navigateur ancien n'envoie pas les en-têtes Fetch Metadata : l'origine
    // suffit alors à trancher.
    expect(foreignProvenance({ origin: "https://evil.example" }, PANEL)).toBe(true);
    expect(foreignProvenance({ origin: "https://panel.example.fr.evil.example" }, PANEL)).toBe(
      true,
    );
  });

  it("refuse une origine opaque ou illisible", () => {
    // `null` : cadre isolé, redirection entre sites, `data:`. Rien n'y dit le
    // panel.
    expect(foreignProvenance({ origin: "null" }, PANEL)).toBe(true);
    expect(foreignProvenance({ origin: "pas une origine" }, PANEL)).toBe(true);
  });

  it("refuse dès qu'un seul des deux en-têtes accuse", () => {
    expect(
      foreignProvenance({ origin: "https://panel.example.fr", fetchSite: "cross-site" }, PANEL),
    ).toBe(true);
    expect(
      foreignProvenance({ origin: "https://evil.example", fetchSite: "same-origin" }, PANEL),
    ).toBe(true);
  });

  it("compare les hôtes sans casse ni port", () => {
    expect(foreignProvenance({ origin: "HTTPS://Panel.Example.FR:443" }, PANEL)).toBe(false);
    expect(foreignProvenance({ origin: "http://localhost:3000" }, ["localhost"])).toBe(false);
  });

  it("ignore les hôtes inconnus de la liste, sans rien accepter pour autant", () => {
    expect(foreignProvenance({ origin: "https://evil.example" }, [null, undefined, ""])).toBe(true);
  });
});

describe("hostOfOrigin", () => {
  it("rend l'hôte d'une origine, sans port ni casse", () => {
    expect(hostOfOrigin("https://Panel.Example.fr:8443")).toBe("panel.example.fr");
    expect(hostOfOrigin("http://localhost:3000")).toBe("localhost");
  });

  it("rend null pour ce qui n'est pas une origine", () => {
    expect(hostOfOrigin(undefined)).toBeNull();
    expect(hostOfOrigin("")).toBeNull();
    expect(hostOfOrigin("null")).toBeNull();
    expect(hostOfOrigin("pas une origine")).toBeNull();
  });
});
