import { describe, expect, it } from "vitest";
import { checkPassword, identityFragments, PASSWORD_MIN_LENGTH } from "./policy";

/**
 * Réponse HIBP simulée.
 *
 * L'API rend des suffixes SHA-1 suivis d'un compte. Le remplissage — des
 * entrées à zéro occurrence, demandées par l'en-tête `Add-Padding` — fait
 * partie du protocole et doit être ignoré, pas compté.
 */
function hibp(body: string) {
  return async () => ({ ok: true, status: 200, text: async () => body });
}

describe("checkPassword, au changement de mot de passe", () => {
  it("accepte un mot de passe long, étranger à l'identité et absent des fuites", async () => {
    const result = await checkPassword("corbeau-lanterne-45-figue", {
      identity: identityFragments("matheo@gamedashboard.fr", "Matheo", "Leduc"),
      fetchImpl: hibp("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0"),
    });
    expect(result.problems).toEqual([]);
    expect(result.pwnedCheckFailed).toBe(false);
  });

  it("refuse un mot de passe qui contient l'identité, même assez long", async () => {
    // Le cas que les règles de complexité laissent toujours passer :
    // « Matheo » plus des chiffres coche majuscule, minuscule et chiffre.
    const result = await checkPassword("Matheo-2026-gamedashboard", {
      identity: identityFragments("matheo@gamedashboard.fr", "Matheo", "Leduc"),
      fetchImpl: hibp(""),
    });
    expect(result.problems).toContainEqual({ kind: "contains-identity" });
  });

  it("refuse un mot de passe trop court en annonçant le minimum exact", async () => {
    const [problem] = await checkPassword("court").then((r) => r.problems);
    expect(problem).toEqual({ kind: "too-short", minimum: PASSWORD_MIN_LENGTH });
  });

  it("laisse passer quand HaveIBeenPwned ne répond pas, en le signalant", async () => {
    // Refuser un mot de passe sain parce qu'un service tiers est tombé
    // pénaliserait sans rien protéger — mais le silence laisserait croire à un
    // contrôle qui n'a pas eu lieu.
    const result = await checkPassword("corbeau-lanterne-45-figue", {
      fetchImpl: async () => {
        throw new Error("réseau injoignable");
      },
    });
    expect(result.problems).toEqual([]);
    expect(result.pwnedCheckFailed).toBe(true);
  });

  it("cumule les manquements plutôt que de s'arrêter au premier", async () => {
    // Corriger la longueur pour se voir opposer l'identité au coup suivant
    // ferait deviner la règle par tâtonnement.
    const result = await checkPassword("matheo", {
      identity: identityFragments("matheo@gamedashboard.fr", "Matheo"),
      fetchImpl: hibp(""),
    });
    expect(result.problems.map((p) => p.kind).sort()).toEqual(["contains-identity", "too-short"]);
  });
});
