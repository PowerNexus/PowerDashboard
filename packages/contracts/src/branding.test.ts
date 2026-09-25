import { describe, expect, it } from "vitest";
import {
  composeBranding,
  DEFAULT_BRANDING,
  isSafeBrandUrl,
  isValidDomain,
  isValidReplyTo,
  mailSender,
  normalizeHex,
  ownershipRecordName,
  SENDER_NAME_MAX_LENGTH,
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
