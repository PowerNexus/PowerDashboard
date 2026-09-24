import { describe, expect, it } from "vitest";
import { authCookieAttributes, cookiesRequireHttps, sessionCookieName } from "./auth-cookies";

describe("cookies d'authentification", () => {
  it("exige HTTPS en production, quelle que soit l'origine déclarée", () => {
    expect(cookiesRequireHttps({ NODE_ENV: "production" })).toBe(true);
    expect(
      cookiesRequireHttps({ NODE_ENV: "production", PANEL_ORIGIN: "http://localhost:3298" }),
    ).toBe(true);
  });

  /**
   * Le défaut d'origine (NC-51) : une unité systemd ou `app.sh` sans
   * `NODE_ENV` servait un panel en HTTPS avec un cookie de session sans
   * `Secure` ni `__Host-`. L'origine publique suffit désormais à les exiger.
   */
  it("exige HTTPS dès que le panel est servi en HTTPS, même sans NODE_ENV", () => {
    for (const env of [
      { PANEL_ORIGIN: "https://panel.gamedashboard.local" },
      { NODE_ENV: "development", PANEL_ORIGIN: "https://tunnel.trycloudflare.com" },
      { PANEL_ORIGIN: "HTTPS://Panel.Example" },
      { PANEL_ORIGIN: "  https://panel.example  " },
    ]) {
      expect(cookiesRequireHttps(env)).toBe(true);
      expect(sessionCookieName(env)).toBe("__Host-gd_session");
    }
  });

  it("reste en clair hors production, sur une origine HTTP ou absente", () => {
    for (const env of [
      {},
      { NODE_ENV: "development" },
      { NODE_ENV: "test", PANEL_ORIGIN: "http://localhost:3000" },
      { PANEL_ORIGIN: "" },
    ]) {
      expect(cookiesRequireHttps(env)).toBe(false);
      expect(sessionCookieName(env)).toBe("gd_session");
    }
  });

  it("donne les mêmes attributs à la pose et à l'effacement", () => {
    expect(authCookieAttributes({ PANEL_ORIGIN: "https://panel.example" })).toEqual({
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    });
    expect(authCookieAttributes({ PANEL_ORIGIN: "http://localhost:3000" }).secure).toBe(false);
  });
});
