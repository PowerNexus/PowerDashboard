import { describe, expect, it } from "vitest";
import { MissingPanelOriginError, relyingPartyFromEnv } from "./relying-party";

describe("relyingPartyFromEnv", () => {
  it("sépare le domaine de l'origine", () => {
    // `rpID` est le domaine seul, `origin` garde schéma et port : les confondre
    // fait échouer toutes les cérémonies, avec un message illisible.
    const rp = relyingPartyFromEnv({
      PANEL_ORIGIN: "https://game.example.fr",
    } as NodeJS.ProcessEnv);
    expect(rp.id).toBe("game.example.fr");
    expect(rp.origin).toBe("https://game.example.fr");
  });

  it("laisse le port hors du domaine, en développement", () => {
    // `localhost:3000` comme rpID ferait refuser la cérémonie par le navigateur.
    const rp = relyingPartyFromEnv({ PANEL_ORIGIN: "http://localhost:3000" } as NodeJS.ProcessEnv);
    expect(rp.id).toBe("localhost");
    expect(rp.origin).toBe("http://localhost:3000");
  });

  it("ignore le chemin, qui ne fait pas partie d'une origine", () => {
    const rp = relyingPartyFromEnv({
      PANEL_ORIGIN: "https://game.example.fr/panel/",
    } as NodeJS.ProcessEnv);
    expect(rp.origin).toBe("https://game.example.fr");
  });

  it("refuse plutôt que de deviner", () => {
    // Une valeur par défaut silencieuse enregistrerait des clés sur un domaine
    // qui n'est pas celui du panel, et personne ne s'en apercevrait avant la
    // première tentative de connexion.
    for (const bad of ["", "game.example.fr", "pas une url"]) {
      expect(() => relyingPartyFromEnv({ PANEL_ORIGIN: bad } as NodeJS.ProcessEnv)).toThrow(
        MissingPanelOriginError,
      );
    }
    expect(() => relyingPartyFromEnv({} as NodeJS.ProcessEnv)).toThrow(MissingPanelOriginError);
  });
});
