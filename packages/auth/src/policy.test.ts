import { describe, expect, it } from "vitest";
import {
  checkPassword,
  checkPasswordShape,
  type FetchLike,
  identityFragments,
  PASSWORD_MIN_LENGTH,
  pwnedCount,
} from "./policy";

const kinds = (password: string, identity: string[] = []) =>
  checkPasswordShape(password, identity).map((p) => p.kind);

describe("checkPasswordShape", () => {
  it("accepte un mot de passe assez long", () => {
    expect(kinds("correct horse battery staple")).toEqual([]);
  });

  it("refuse en dessous du minimum", () => {
    expect(kinds("court")).toContain("too-short");
  });

  it("accepte exactement le minimum", () => {
    expect(kinds("a".repeat(PASSWORD_MIN_LENGTH))).toEqual([]);
  });

  it("compte les points de code et non les unités UTF-16", () => {
    // 12 emoji font 24 unités pour `.length`. Compter les unités laisserait
    // passer un mot de passe deux fois plus court que la règle annoncée.
    expect(kinds("🔑".repeat(11))).toContain("too-short");
    expect(kinds("🔑".repeat(12))).toEqual([]);
  });

  it("refuse une entrée démesurée", () => {
    expect(kinds("a".repeat(500))).toContain("too-long");
  });

  it("n'impose aucune classe de caractères", () => {
    // Exiger majuscule, chiffre et symbole produit surtout des « Motdepasse1! ».
    expect(kinds("aaaaaaaaaaaaaaa")).toEqual([]);
  });

  it("refuse un mot de passe qui contient l'identité", () => {
    expect(kinds("matheo-gamedashboard-2026", ["matheo"])).toContain("contains-identity");
  });

  it("ignore la casse dans la comparaison d'identité", () => {
    expect(kinds("MonMotDePasseMatheo", ["matheo"])).toContain("contains-identity");
  });

  it("ignore les fragments d'identité trop courts", () => {
    // « fr » apparaît dans quantité de mots : refuser sur deux lettres
    // produirait des rejets incompréhensibles.
    expect(kinds("une phrase de passe", ["fr"])).toEqual([]);
  });
});

describe("identityFragments", () => {
  it("éclate une adresse e-mail en morceaux exploitables", () => {
    expect(identityFragments("jean.dupont@gamedashboard.fr", "Jean", "Dupont")).toEqual([
      "jean",
      "dupont",
      "gamedashboard",
      "fr",
      "Jean",
      "Dupont",
    ]);
  });
});

/** Réponse HIBP simulée : suffixes SHA-1 et nombre d'occurrences. */
const hibp = (body: string, ok = true, status = 200): FetchLike => {
  return async () => ({ ok, status, text: async () => body });
};

/** SHA-1 de « password » : 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8. */
const PASSWORD_SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

describe("pwnedCount", () => {
  it("trouve un mot de passe présent dans les fuites", async () => {
    const count = await pwnedCount("password", hibp(`${PASSWORD_SUFFIX}:9659365\r\nAAAA:2`));
    expect(count).toBe(9_659_365);
  });

  it("renvoie zéro quand le suffixe est absent", async () => {
    expect(await pwnedCount("password", hibp("0000000000000000000000000000000000A:5"))).toBe(0);
  });

  it("ne transmet que les cinq premiers caractères de l'empreinte", async () => {
    let requested = "";
    const spy: FetchLike = async (url) => {
      requested = url;
      return { ok: true, status: 200, text: async () => "" };
    };
    await pwnedCount("password", spy);
    // L'empreinte complète ne doit jamais partir : HIBP ne peut pas savoir
    // quel mot de passe a été testé.
    expect(requested).toBe("https://api.pwnedpasswords.com/range/5BAA6");
    expect(requested).not.toContain(PASSWORD_SUFFIX);
  });

  it("ignore les entrées de remplissage à zéro occurrence", async () => {
    // L'en-tête Add-Padding fait ajouter de faux suffixes comptés à zéro, pour
    // que la taille de la réponse ne trahisse rien. Les compter ferait refuser
    // des mots de passe sains.
    expect(await pwnedCount("password", hibp(`${PASSWORD_SUFFIX}:0`))).toBe(0);
  });

  it("signale une réponse en erreur au lieu de conclure à zéro", async () => {
    await expect(pwnedCount("password", hibp("", false, 503))).rejects.toThrow("503");
  });
});

describe("checkPassword", () => {
  it("ajoute le problème « pwned » quand le mot de passe a fuité", async () => {
    const { problems } = await checkPassword("password", {
      fetchImpl: hibp(`${PASSWORD_SUFFIX}:9659365`),
    });
    expect(problems).toContainEqual({ kind: "pwned", occurrences: 9_659_365 });
  });

  it("ne bloque pas quand HaveIBeenPwned est indisponible", async () => {
    // Refuser un mot de passe valide parce qu'un service tiers est en panne
    // pénalise l'utilisateur sans rien protéger.
    const result = await checkPassword("une phrase de passe correcte", {
      fetchImpl: hibp("", false, 503),
    });
    expect(result.problems).toEqual([]);
    expect(result.pwnedCheckFailed).toBe(true);
  });

  it("applique la forme même sans vérification de fuite", async () => {
    const { problems, pwnedCheckFailed } = await checkPassword("court");
    expect(problems.map((p) => p.kind)).toContain("too-short");
    expect(pwnedCheckFailed).toBe(false);
  });
});
