import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./content-security-policy";

/**
 * Politique de sécurité de contenu : aucun script tiers hors Turnstile
 * (NC-22, ASVS 14.2.3, 10.3.2).
 *
 * Le défaut : Monaco se chargeait depuis `cdn.jsdelivr.net`, sans empreinte
 * d'intégrité, et la politique autorisait ce CDN en `script-src`. Une
 * compromission du CDN, ou du paquet publié, exécutait son script dans le
 * panel, avec la session de l'administrateur qui ouvre l'éditeur d'egg.
 * Monaco est désormais servi par le panel lui-même.
 */

function directives(politique: string): Map<string, string[]> {
  return new Map(
    politique.split(";").map((d) => {
      const [nom = "", ...sources] = d.trim().split(/\s+/);
      return [nom, sources] as const;
    }),
  );
}

describe("contentSecurityPolicy", () => {
  for (const production of [true, false]) {
    const politique = contentSecurityPolicy("bm9uY2U=", production);
    const lues = directives(politique);

    it(`ne nomme aucun CDN (${production ? "production" : "développement"})`, () => {
      expect(politique).not.toContain("jsdelivr");
    });

    it(`n'autorise que Turnstile comme script d'un autre hôte (${production ? "production" : "développement"})`, () => {
      const hotes = (lues.get("script-src") ?? []).filter((s) => s.startsWith("https://"));
      expect(hotes).toEqual(["https://challenges.cloudflare.com"]);
    });

    it(`ne tire styles et polices que du panel (${production ? "production" : "développement"})`, () => {
      for (const nom of ["style-src", "font-src"]) {
        const hotes = (lues.get(nom) ?? []).filter((s) => s.startsWith("https://"));
        expect(hotes, nom).toEqual([]);
      }
    });
  }

  it("laisse les workers de Monaco venir du panel", () => {
    // Les workers de l'éditeur sont des fichiers du panel (`/_next/static`),
    // créés en module ; `blob:` reste pour ceux que Monaco enveloppe.
    const lues = directives(contentSecurityPolicy("bm9uY2U=", true));
    expect(lues.get("worker-src")).toEqual(["'self'", "blob:"]);
  });
});
