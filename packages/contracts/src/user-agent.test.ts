import { describe, expect, it } from "vitest";
import { DEVICE_RAW_MAX, describeUserAgent } from "./user-agent";

describe("describeUserAgent", () => {
  it("reconnaît Firefox sur Windows", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
      ),
    ).toEqual({ browser: "Firefox", platform: "Windows", raw: null, kind: "desktop" });
  });

  it("reconnaît Safari sur iPhone comme un mobile", () => {
    const result = describeUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    );
    expect(result.browser).toBe("Safari");
    expect(result.platform).toBe("iPhone");
    expect(result.kind).toBe("mobile");
  });

  /**
   * L'ordre des motifs est la seule chose qui distingue ces navigateurs :
   * chacun se déclare comme le suivant dans son propre en-tête. Une
   * réorganisation de la liste ferait annoncer « Chrome » à quelqu'un qui
   * utilise Edge — d'où un test par cas plutôt qu'un seul.
   */
  it.each([
    [
      "Edge",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
    ],
    [
      "Opera",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0",
    ],
    [
      "Chrome",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    ],
    [
      "Safari",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    ],
  ])("distingue %s des navigateurs qu'il imite", (expected, userAgent) => {
    expect(describeUserAgent(userAgent).browser).toBe(expected);
  });

  it("préfère Android à Linux, que son en-tête contient aussi", () => {
    const result = describeUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    );
    expect(result.platform).toBe("Android");
    expect(result.kind).toBe("mobile");
  });

  it("préfère iPad à macOS, qu'iPadOS annonce depuis la version 13", () => {
    const result = describeUserAgent(
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1",
    );
    expect(result.platform).toBe("iPad");
    expect(result.kind).toBe("mobile");
  });

  it("ne prétend pas distinguer Windows 10 de Windows 11", () => {
    // Les deux envoient « Windows NT 10.0 ». Écrire « Windows 11 » ferait
    // douter de la liste entière à qui est resté sur Windows 10.
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)").platform).toBe("Windows");
  });

  it("reconnaît un outil sans le faire passer pour un appareil", () => {
    // « curl/8.7.1 » s'affichait comme un nom d'appareil, à côté d'un
    // ordinateur portable : une clé d'API employée par un script doit se lire
    // comme telle.
    const result = describeUserAgent("curl/8.7.1");
    expect(result).toEqual({ browser: "curl", platform: null, raw: null, kind: "tool" });
  });

  it("avoue ne pas savoir quand l'agent est celui du panel lui-même", () => {
    // Le navigateur ne parle jamais à l'API : quand le relais de l'agent réel
    // manque, elle reçoit celui du serveur de rendu. Afficher « node » ferait
    // chercher un appareil de ce nom dans la liste.
    for (const own of ["node", "undici", "next/15.0.0", "node-fetch/1.0"]) {
      expect(describeUserAgent(own)).toEqual({
        browser: null,
        platform: null,
        raw: null,
        kind: "unknown",
      });
    }
  });

  it("tronque un en-tête brut démesuré", () => {
    const result = describeUserAgent("z".repeat(500));
    expect(result.raw).toHaveLength(DEVICE_RAW_MAX);
  });

  it("ne décrit rien plutôt que d'inventer quand l'en-tête manque", () => {
    for (const value of [null, undefined, ""]) {
      expect(describeUserAgent(value)).toEqual({
        browser: null,
        platform: null,
        raw: null,
        kind: "unknown",
      });
    }
  });
});
