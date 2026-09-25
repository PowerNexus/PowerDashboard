import { describe, expect, it } from "vitest";
import { emailLink } from "./notifications.service";

/** Le lien d'un courriel de notification : absolu, ou absent. */
describe("emailLink", () => {
  it("rend un chemin interne absolu sur le domaine de la marque", () => {
    expect(emailLink("/server/abc", "panel.revendeur.fr")).toBe(
      "https://panel.revendeur.fr/server/abc",
    );
  });

  it("laisse passer une adresse externe telle quelle", () => {
    expect(emailLink("https://client.facturier.fr/facture/9", null)).toBe(
      "https://client.facturier.fr/facture/9",
    );
  });

  it("ne met pas de lien sans domaine, ni vers un autre hôte", () => {
    expect(emailLink("/server/abc", null)).toBe(null);
    expect(emailLink("//ailleurs.fr/x", "panel.fr")).toBe(null);
    expect(emailLink("javascript:alert(1)", "panel.fr")).toBe(null);
    expect(emailLink(null, "panel.fr")).toBe(null);
  });
});
