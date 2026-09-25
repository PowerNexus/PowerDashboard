import type { Database } from "@gamedashboard/db";
import { describe, expect, it } from "vitest";
import type { PlatformSettingsService } from "../admin/platform-settings.service";
import { BrandingService, brandingInput } from "./branding.service";

/**
 * Marque de la plateforme : tous ses champs sont lus, pas seulement le nom et
 * l'accent.
 *
 * Longtemps, `platformOverrides` ne lisait que ces deux réglages. Le logo, le
 * favicon, le lien d'assistance, les conditions, le pied de page et l'accroche
 * de connexion n'existaient que pour les revendeurs : la plateforme affichait
 * toujours ceux du produit, quoi qu'on enregistre.
 *
 * Sans base : sur l'hôte vide (le domaine de la plateforme), `forHost` ne
 * cherche aucun revendeur et ne lit que les réglages.
 */
function service(reglages: Record<string, string>) {
  const lus: string[] = [];
  const settings = {
    text: async (key: string) => {
      lus.push(key);
      return reglages[key] ?? "";
    },
  } as unknown as PlatformSettingsService;

  // Aucune requête ne doit partir : une base absente le ferait savoir.
  return { svc: new BrandingService(null as unknown as Database, settings), lus };
}

describe("BrandingService — marque de la plateforme", () => {
  it("lit logo, favicon, liens, pied de page et accroche", async () => {
    const { svc } = service({
      "brand.name": "Hébergeur",
      "brand.accent": "#0ea5e9",
      "brand.logoUrl": "https://cdn.hebergeur.fr/logo.webp",
      "brand.faviconUrl": "/favicon-hebergeur.png",
      "brand.supportUrl": "https://aide.hebergeur.fr",
      "brand.termsUrl": "https://hebergeur.fr/cgu",
      "brand.footerText": "© Hébergeur SAS",
      "brand.loginTagline": "Vos serveurs, sans attendre",
    });

    expect(await svc.forHost(null)).toEqual({
      name: "Hébergeur",
      accent: "#0ea5e9",
      logoUrl: "https://cdn.hebergeur.fr/logo.webp",
      faviconUrl: "/favicon-hebergeur.png",
      supportUrl: "https://aide.hebergeur.fr",
      termsUrl: "https://hebergeur.fr/cgu",
      footerText: "© Hébergeur SAS",
      loginTagline: "Vos serveurs, sans attendre",
      replyTo: null,
      resellerId: null,
    });
  });

  it("retombe sur le produit pour ce que la plateforme laisse vide", async () => {
    const { svc } = service({ "brand.logoUrl": "https://cdn.hebergeur.fr/logo.webp" });
    const marque = await svc.forHost(null);

    expect(marque.name).toBe("GameDashboard");
    // Le logo sert d'icône d'onglet quand aucun favicon n'est posé.
    expect(marque.faviconUrl).toBe("https://cdn.hebergeur.fr/logo.webp");
    expect(marque.supportUrl).toBeNull();
  });

  it("oublie la marque servie quand la plateforme change la sienne", async () => {
    const reglages: Record<string, string> = { "brand.name": "Avant" };
    const { svc } = service(reglages);
    expect((await svc.forHost(null)).name).toBe("Avant");

    reglages["brand.name"] = "Après";
    // Encore en cache : c'est le comportement voulu entre deux écritures.
    expect((await svc.forHost(null)).name).toBe("Avant");
    svc.forgetAll();
    expect((await svc.forHost(null)).name).toBe("Après");
  });
});

/**
 * Non-régression : la route du revendeur recopiait les champs un par un et
 * avait oublié `replyTo`. Le formulaire l'envoyait, la route le jetait, et
 * chaque enregistrement de la marque effaçait l'adresse de réponse.
 */
describe("brandingInput — champs lus dans le corps", () => {
  it("garde l'adresse de réponse, et tous les champs de la marque", () => {
    const lu = brandingInput({
      name: "Revendeur",
      logoUrl: "/brand/fichier/0b6f2c1e-4a8d-4c52-9d0e-7a1b2c3d4e5f",
      replyTo: "support@revendeur.fr",
    });
    expect(lu.replyTo).toBe("support@revendeur.fr");
    expect(lu.name).toBe("Revendeur");
    expect(Object.keys(lu).sort()).toEqual(
      [
        "accent",
        "faviconUrl",
        "footerText",
        "loginTagline",
        "logoUrl",
        "name",
        "replyTo",
        "supportUrl",
        "termsUrl",
      ].sort(),
    );
  });

  it("vide ce qui n'est pas une chaîne", () => {
    expect(brandingInput({ name: 42, replyTo: ["a@b.fr"] })).toMatchObject({
      name: "",
      replyTo: "",
    });
    expect(brandingInput(null).accent).toBe("");
  });
});
