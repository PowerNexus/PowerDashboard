import { describe, expect, it } from "vitest";
import {
  apiKeyPrefix,
  generateApiKey,
  generateToken,
  hashToken,
  tokensMatch,
  tokenValidity,
} from "./tokens";

describe("generateToken", () => {
  it("produit un jeton d'au moins 256 bits d'entropie", () => {
    // 32 octets encodés en base64url : 43 caractères sans remplissage.
    expect(generateToken()).toHaveLength(43);
  });

  it("ne produit jamais deux fois le même jeton", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateToken()));
    expect(seen.size).toBe(500);
  });

  it("n'utilise que des caractères sûrs en URL et en cookie", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe("hashToken", () => {
  it("est déterministe", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("ne laisse pas transparaître le jeton", () => {
    const token = generateToken();
    expect(hashToken(token)).not.toContain(token);
  });
});

describe("tokensMatch", () => {
  it("reconnaît deux valeurs identiques", () => {
    expect(tokensMatch("abcdef", "abcdef")).toBe(true);
  });

  it("rejette deux valeurs différentes de même longueur", () => {
    expect(tokensMatch("abcdef", "abcdeg")).toBe(false);
  });

  it("rejette des longueurs différentes sans lever d'exception", () => {
    // timingSafeEqual exige des tampons de même taille : sans la vérification
    // préalable, un jeton tronqué ferait planter la requête au lieu de la refuser.
    expect(() => tokensMatch("court", "beaucoup plus long")).not.toThrow();
    expect(tokensMatch("court", "beaucoup plus long")).toBe(false);
  });

  it("gère les chaînes vides", () => {
    expect(tokensMatch("", "")).toBe(true);
    expect(tokensMatch("", "a")).toBe(false);
  });
});

describe("generateApiKey", () => {
  it("préfixe la clé pour qu'un scanner de secrets la reconnaisse", () => {
    expect(generateApiKey().plaintext).toMatch(/^gd_live_[0-9a-f]{12}_/);
  });

  it("distingue les environnements", () => {
    expect(generateApiKey("test").prefix).toMatch(/^gd_test_/);
  });

  it("n'accepte que le préfixe du produit", () => {
    // Un préfixe d'une époque antérieure du projet était accepté en plus. Il
    // ne l'est plus : aucune clé ne le portait, et le garder faisait annoncer
    // aux intégrateurs, sur l'écran « API », un préfixe que le panel n'émet
    // pas. Une clé présentée sous un autre préfixe est refusée à la lecture,
    // avant toute comparaison de condensat.
    expect(apiKeyPrefix("gd_live_abcdef123456_secret")).toBe("gd_live_abcdef123456");
    expect(apiKeyPrefix("yh_live_abcdef123456_secret")).toBeNull();
    expect(apiKeyPrefix("xx_live_abcdef123456_secret")).toBeNull();
  });

  it("ne stocke jamais la clé en clair", () => {
    const key = generateApiKey();
    expect(key.hash).not.toContain(key.plaintext);
    expect(key.hash).toBe(hashToken(key.plaintext));
  });

  it("le préfixe stocké permet de retrouver la clé présentée", () => {
    const key = generateApiKey();
    expect(apiKeyPrefix(key.plaintext)).toBe(key.prefix);
  });

  it("le préfixe seul ne permet pas de reconstituer la clé", () => {
    const key = generateApiKey();
    expect(key.plaintext.length).toBeGreaterThan(key.prefix.length + 40);
  });
});

describe("apiKeyPrefix", () => {
  it("refuse une chaîne qui n'a pas la forme attendue", () => {
    expect(apiKeyPrefix("pas-une-cle")).toBe(null);
    expect(apiKeyPrefix("gd_live_abc")).toBe(null);
    expect(apiKeyPrefix("xx_live_abc_secret")).toBe(null);
  });
});

describe("tokenValidity", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();

  it("accepte une session non expirée", () => {
    expect(tokenValidity({ expiresAt: future })).toBe("valid");
  });

  it("refuse une session expirée", () => {
    expect(tokenValidity({ expiresAt: past })).toBe("expired");
  });

  it("distingue une session révoquée d'une session expirée", () => {
    // L'utilisateur doit pouvoir constater dans /account/security qu'une
    // session a été fermée, et non la voir disparaître sans explication.
    expect(tokenValidity({ expiresAt: future, revokedAt: past })).toBe("revoked");
  });

  it("la révocation l'emporte sur l'expiration", () => {
    expect(tokenValidity({ expiresAt: past, revokedAt: past })).toBe("revoked");
  });

  it("refuse une session qui expire à l'instant même", () => {
    const now = Date.now();
    expect(tokenValidity({ expiresAt: new Date(now).toISOString() }, now)).toBe("expired");
  });
});
