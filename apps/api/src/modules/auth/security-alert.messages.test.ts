import { describe, expect, it } from "vitest";
import {
  credentialChangeTexts,
  describeDevice,
  failureAlertTexts,
  formatWhen,
  newDeviceAlertTexts,
} from "./security-alert.messages";

const AT = new Date("2026-09-23T08:30:00.000Z");
const LINK = "https://gamedashboard.local/account/security";

describe("textes des alertes de sécurité", () => {
  it("écrit l'alerte d'échecs dans la langue du compte, avec tout ce qu'il faut", () => {
    const fr = failureAlertTexts({
      locale: "fr",
      brand: "GameDashboard",
      count: 5,
      ip: "203.0.113.7",
      when: formatWhen("fr", "Europe/Paris", AT),
      link: LINK,
    });
    expect(fr.subject).toBe("Tentatives de connexion échouées sur votre compte GameDashboard");
    expect(fr.text).toContain("5 tentatives");
    expect(fr.text).toContain("203.0.113.7");
    // Heure dans le fuseau du compte : 8 h 30 UTC, 10 h 30 à Paris.
    expect(fr.text).toContain("10:30");
    expect(fr.text).toContain("double authentification");
    expect(fr.text).toContain(LINK);

    const en = failureAlertTexts({
      locale: "en",
      brand: "GameDashboard",
      count: 5,
      ip: "203.0.113.7",
      when: formatWhen("en", "UTC", AT),
      link: LINK,
    });
    expect(en.subject).toBe("Failed sign-in attempts on your GameDashboard account");
    expect(en.text).toContain("two-factor");
    expect(en.text).toContain(LINK);
  });

  it("ne cite un pays que lorsqu'on le connaît", () => {
    const base = {
      locale: "fr",
      brand: "GameDashboard",
      device: describeDevice(
        "fr",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
      ),
      ip: "198.51.100.4",
      when: formatWhen("fr", "Europe/Paris", AT),
      link: LINK,
    };

    const withCountry = newDeviceAlertTexts({ ...base, country: "DE" });
    expect(withCountry.text).toContain("Appareil : Firefox sur Windows");
    expect(withCountry.text).toContain("Pays : Allemagne");
    expect(withCountry.text).toContain(LINK);

    const without = newDeviceAlertTexts({ ...base, country: null });
    expect(without.text).not.toContain("Pays");
  });

  it("nomme le changement d'authentifiant, d'où et quand, et mène à la page de sécurité", () => {
    const fr = credentialChangeTexts({
      locale: "fr",
      brand: "GameDashboard",
      kind: "twoFactorDisabled",
      ip: "203.0.113.7",
      when: formatWhen("fr", "Europe/Paris", AT),
      link: LINK,
    });
    expect(fr.subject).toBe("Double authentification désactivée sur votre compte GameDashboard");
    expect(fr.title).toBe("Double authentification désactivée");
    expect(fr.text).toContain("Adresse IP : 203.0.113.7");
    expect(fr.text).toContain("10:30");
    expect(fr.text).toContain(LINK);

    const en = credentialChangeTexts({
      locale: "en",
      brand: "GameDashboard",
      kind: "passwordChanged",
      ip: null,
      when: formatWhen("en", "UTC", AT),
      link: LINK,
    });
    expect(en.subject).toBe("Password changed on your GameDashboard account");
    // Sans adresse connue, la ligne disparaît plutôt que d'écrire « inconnue ».
    expect(en.text).not.toContain("IP address");
  });

  it("renvoie vers le support, et non vers le compte, quand l'adresse a changé", () => {
    // Ce message part vers l'**ancienne** boîte : on se connecte désormais avec
    // la nouvelle, et un lien vers la page de sécurité ne lui servirait à rien.
    const texts = credentialChangeTexts({
      locale: "fr",
      brand: "GameDashboard",
      kind: "emailChanged",
      ip: null,
      when: formatWhen("fr", "Europe/Paris", AT),
      link: LINK,
    });
    expect(texts.subject).toBe("Adresse e-mail modifiée sur votre compte GameDashboard");
    expect(texts.text).toContain("support");
    expect(texts.text).not.toContain(LINK);
  });

  it("retombe sur le français pour une langue inconnue", () => {
    expect(
      newDeviceAlertTexts({
        locale: "de",
        brand: "X",
        device: "Firefox",
        ip: null,
        country: null,
        when: "",
        link: LINK,
      }).subject,
    ).toBe("Nouvelle connexion à votre compte X");
  });
});
