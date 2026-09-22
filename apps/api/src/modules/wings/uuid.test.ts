import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { UUID_V4, WingsUnavailableError } from "./wings-client.service";

/**
 * Wings valide `IsUUIDv4` sur `POST /api/servers` : un identifiant bien formé
 * mais d'une autre version est refusé par un 422 sans explication.
 */
describe("identifiant accepté par le daemon", () => {
  it("accepte ce que le panel génère", () => {
    for (let i = 0; i < 50; i++) expect(UUID_V4.test(randomUUID())).toBe(true);
  });

  it("refuse un identifiant bien formé mais pas de version 4", () => {
    // Cas réel : le serveur de démonstration inséré à la main. Le chiffre de
    // version vaut 0 là où il doit valoir 4.
    expect(UUID_V4.test("eeeeeeee-0000-0000-0000-000000000001")).toBe(false);
  });

  it("refuse une variante hors plage", () => {
    // Le quatrième groupe doit commencer par 8, 9, a ou b.
    expect(UUID_V4.test("8cddb6da-0d02-4d29-1a64-a7dce45922e0")).toBe(false);
  });

  it("accepte les quatre variantes admises", () => {
    for (const variant of ["8", "9", "a", "b"]) {
      expect(UUID_V4.test(`8cddb6da-0d02-4d29-${variant}a64-a7dce45922e0`)).toBe(true);
    }
  });

  it("refuse ce qui n'est pas un UUID", () => {
    expect(UUID_V4.test("pas-un-uuid")).toBe(false);
    expect(UUID_V4.test("")).toBe(false);
  });
});

describe("WingsUnavailableError", () => {
  it("distingue « ce serveur n'existe pas » de « le node ne répond pas »", () => {
    /*
     * Relevé en exploitation : une création interrompue laissait une ligne en
     * base et un 404 côté daemon. La suppression s'arrêtait là, et la ligne
     * devenait ineffaçable. Les deux cas demandent des décisions opposées —
     * retirer la ligne, ou refuser pour ne pas perdre la trace d'un conteneur
     * qui tourne encore.
     */
    expect(new WingsUnavailableError("N1", "HTTP 404", 404).isNotFound).toBe(true);
    expect(new WingsUnavailableError("N1", "HTTP 500", 500).isNotFound).toBe(false);
  });

  it("ne prend pas un silence pour une absence", () => {
    // Sans réponse, on ne sait rien : surtout pas que le serveur n'existe pas.
    expect(new WingsUnavailableError("N1", "connexion refusée").isNotFound).toBe(false);
  });
});
