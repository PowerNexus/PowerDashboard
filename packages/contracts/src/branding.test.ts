import { describe, expect, it } from "vitest";
import {
  BRAND_IMAGE_PATH_PREFIX,
  brandImageIdOf,
  brandImagePath,
  composeBranding,
  DEFAULT_BRANDING,
  isSafeBrandUrl,
  isValidDomain,
  isValidReplyTo,
  mailSender,
  normalizeHex,
  ownershipRecordName,
  SENDER_NAME_MAX_LENGTH,
  sniffBrandImage,
} from "./branding";

const PLATFORM = {
  name: "GameDashboard",
  accent: "#7c3aed",
  logoUrl: "/brand/gamedashboard-logo.webp",
};

describe("composition de la marque", () => {
  it("retombe champ par champ, et non tout ou rien", () => {
    // Un revendeur qui ne change que la couleur garde le nom et le logo de la
    // plateforme : l'obliger à tout redéclarer pour ajuster une teinte ferait
    // des marques blanches à moitié remplies.
    const branding = composeBranding(PLATFORM, { resellerId: "r1", accent: "#0ea5e9" });

    expect(branding.accent).toBe("#0ea5e9");
    expect(branding.name).toBe("GameDashboard");
    expect(branding.logoUrl).toBe("/brand/gamedashboard-logo.webp");
    expect(branding.resellerId).toBe("r1");
  });

  it("emploie le logo du revendeur comme favicon quand il n'en donne pas", () => {
    // Poser son logo sans favicon, c'est vouloir le sien dans l'onglet — pas
    // celui de la plateforme à côté de son propre nom.
    const branding = composeBranding(PLATFORM, {
      resellerId: "r1",
      logoUrl: "https://cdn.exemple.fr/logo.png",
    });

    expect(branding.faviconUrl).toBe("https://cdn.exemple.fr/logo.png");
  });

  it("rend la marque de la plateforme quand aucun revendeur ne s'applique", () => {
    expect(composeBranding(PLATFORM, null).resellerId).toBe(null);
    expect(composeBranding({}, null)).toEqual(DEFAULT_BRANDING);
  });

  it("laisse à null ce que personne n'a rempli", () => {
    // Un lien d'assistance inventé mènerait à une page qui n'existe pas :
    // l'écran cesse simplement de le proposer.
    expect(composeBranding(PLATFORM, null).supportUrl).toBe(null);
  });
});

describe("couleur d'accent", () => {
  it("accepte les trois longueurs hexadécimales", () => {
    for (const value of ["#fff", "#7c3aed", "#7c3aedcc"]) {
      expect(normalizeHex(value)).toBe(value);
    }
  });

  it("refuse tout ce qui n'est pas une couleur", () => {
    /*
     * Cette valeur part dans une variable CSS. Une chaîne arbitraire y ferait
     * entrer une déclaration entière — c'est une injection de style, pas une
     * faute de frappe.
     */
    for (const value of ["red", "#xyzxyz", "#7c3aed; --gd-bg: red", "", "url(x)"]) {
      expect(normalizeHex(value)).toBe(null);
    }
  });

  it("retombe sur la couleur du produit plutôt que d'écrire une valeur refusée", () => {
    const branding = composeBranding(PLATFORM, { resellerId: "r1", accent: "vert" });
    expect(branding.accent).toBe("#7c3aed");
  });
});

describe("domaine propre", () => {
  it("accepte un nom d'hôte ordinaire", () => {
    expect(isValidDomain("panel.revendeur.fr")).toBe(true);
    expect(isValidDomain("PANEL.Revendeur.FR")).toBe(true);
  });

  it("refuse ce qui ne se délègue pas", () => {
    // Pas d'étiquette de tête, tiret en bordure, espace, schéma recopié : tous
    // se corrigent chez le registraire, pas ici.
    for (const value of ["localhost", "-revendeur.fr", "revendeur-.fr", "https://a.fr", "a b.fr"]) {
      expect(isValidDomain(value)).toBe(false);
    }
  });

  it("nomme l'enregistrement de preuve sous une étiquette dédiée", () => {
    // Sous `_gamedashboard.` et non sur le domaine lui-même : celui-ci porte déjà un
    // CNAME, et un CNAME exclut tout autre enregistrement au même nom.
    expect(ownershipRecordName("Panel.Revendeur.fr")).toBe("_gamedashboard.panel.revendeur.fr");
  });
});

describe("adresses de marque", () => {
  it.each([
    "",
    "/brand/logo.webp",
    "https://cdn.exemple.fr/logo.webp",
    "HTTPS://cdn.exemple.fr/logo.webp",
  ])("accepte « %s »", (adresse) => {
    expect(isSafeBrandUrl(adresse)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    " javascript:alert(1)",
    "http://cdn.exemple.fr/logo.webp",
    "data:image/svg+xml;base64,PHN2Zz4=",
    // Commencent par « / » mais désignent un autre hôte.
    "//malveillant.exemple/logo.webp",
    "/\\malveillant.exemple/logo.webp",
    "https://",
  ])("refuse « %s »", (adresse) => {
    expect(isSafeBrandUrl(adresse)).toBe(false);
  });
});

describe("adresse de réponse et expéditeur des courriels", () => {
  it("accepte une adresse, refuse ce qui ajouterait un en-tête ou un destinataire", () => {
    expect(isValidReplyTo("")).toBe(true);
    expect(isValidReplyTo("support@revendeur.fr")).toBe(true);
    for (const adresse of [
      "support@revendeur.fr\r\nBcc: tous@exemple.fr",
      "a@b.fr, c@d.fr",
      "Support <support@revendeur.fr>",
      "pas-une-adresse",
      "a@b",
      `${"a".repeat(250)}@b.fr`,
      "a\u0000@b.fr",
    ]) {
      expect(isValidReplyTo(adresse), adresse).toBe(false);
    }
  });

  it("retombe sur l'adresse de la plateforme, et écarte une valeur invalide déjà rangée", () => {
    expect(composeBranding({ replyTo: "aide@hebergeur.fr" }, null).replyTo).toBe(
      "aide@hebergeur.fr",
    );
    expect(
      composeBranding({ replyTo: "aide@hebergeur.fr" }, { resellerId: "r1", replyTo: "r@rev.fr" })
        .replyTo,
    ).toBe("r@rev.fr");
    expect(composeBranding({ replyTo: "x\ny@z.fr" }, null).replyTo).toBe(null);
    expect(composeBranding({}, null).replyTo).toBe(null);
  });

  it("donne un nom d'expéditeur sans caractère d'en-tête", () => {
    expect(mailSender({ name: 'Rev "Hébergement" <x>', replyTo: null })).toEqual({
      fromName: "Rev Hébergement x",
      replyTo: null,
    });
    expect(mailSender({ name: "A\r\nBcc: b@c.fr", replyTo: "r@rev.fr" })).toEqual({
      fromName: "A Bcc: b@c.fr",
      replyTo: "r@rev.fr",
    });
    expect(mailSender({ name: "   ", replyTo: null }).fromName).toBe(DEFAULT_BRANDING.name);
    expect(mailSender({ name: "x".repeat(200), replyTo: null }).fromName).toHaveLength(
      SENDER_NAME_MAX_LENGTH,
    );
  });
});

/**
 * Type réel d'une image envoyée : lu dans ses octets, jamais dans son nom.
 *
 * Un SVG porte du script ; ouvert à son adresse, il s'exécuterait sous le
 * domaine du panel. Il doit être refusé même renommé en `.png`.
 */
describe("images de marque envoyées", () => {
  const octets = (...valeurs: number[]) => Uint8Array.from(valeurs);
  const texte = (valeur: string) => new TextEncoder().encode(valeur);

  it("reconnaît PNG, JPEG, WebP et ICO à leur signature", () => {
    expect(sniffBrandImage(octets(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      "image/png",
    );
    expect(sniffBrandImage(octets(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffBrandImage(texte("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("image/webp");
    expect(sniffBrandImage(octets(0, 0, 1, 0, 1, 0, 16, 16))).toBe("image/x-icon");
  });

  it("refuse le SVG, le HTML et ce qui n'est qu'un début de signature", () => {
    expect(sniffBrandImage(texte('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBe(
      null,
    );
    expect(sniffBrandImage(texte('<?xml version="1.0"?><svg/>'))).toBe(null);
    expect(sniffBrandImage(texte("<html><script>alert(1)</script></html>"))).toBe(null);
    expect(sniffBrandImage(octets(0x89, 0x50, 0x4e, 0x47))).toBe(null);
    expect(sniffBrandImage(texte("RIFF\u0000\u0000\u0000\u0000WAVE"))).toBe(null);
    // Un curseur (.cur, type 2) ou un répertoire vide n'est pas une icône.
    expect(sniffBrandImage(octets(0, 0, 2, 0, 1, 0))).toBe(null);
    expect(sniffBrandImage(octets(0, 0, 1, 0, 0, 0))).toBe(null);
    expect(sniffBrandImage(new Uint8Array())).toBe(null);
  });

  it("sert l'image sous un chemin interne, que la règle des adresses accepte", () => {
    const id = "0b6f2c1e-4a8d-4c52-9d0e-7a1b2c3d4e5f";
    const chemin = brandImagePath(id);
    expect(chemin.startsWith(BRAND_IMAGE_PATH_PREFIX)).toBe(true);
    expect(isSafeBrandUrl(chemin)).toBe(true);
    expect(brandImageIdOf(chemin)).toBe(id);
  });

  it("ne reconnaît comme image envoyée qu'un identifiant complet", () => {
    expect(brandImageIdOf("https://cdn.exemple.fr/logo.png")).toBe(null);
    expect(brandImageIdOf(`${BRAND_IMAGE_PATH_PREFIX}../../api/v1/admin`)).toBe(null);
    expect(brandImageIdOf(`${BRAND_IMAGE_PATH_PREFIX}0b6f2c1e`)).toBe(null);
  });
});
