import { describe, expect, it } from "vitest";
import {
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
