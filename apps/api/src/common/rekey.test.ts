import { decryptSecret, encryptSecret } from "@gamedashboard/auth";
import { describe, expect, it } from "vitest";
import { ciphertextParts, createRekeyer } from "./rekey";

/** Le sel de `packages/auth/src/secrets.ts`, redit comme dans le script. */
const SEL = "gamedashboard.secrets.v2";
const ANCIENNE = { APP_SECRET_KEY: "ancienne-cle-maitre-compromise-0123456789" };
const NOUVELLE = { APP_SECRET_KEY: "nouvelle-cle-maitre-0123456789abcdef" };

const rotation = createRekeyer({
  fromSecret: ANCIENNE.APP_SECRET_KEY,
  fromSalt: SEL,
  toSecret: NOUVELLE.APP_SECRET_KEY,
  toSalt: SEL,
});

describe("rechiffrement des secrets", () => {
  /*
   * Non-régression : le script ne retenait que les valeurs en trois parties.
   * Tout ce que `encryptSecret` écrit aujourd'hui porte le préfixe `v3:` —
   * quatre parties — et était donc sauté sans un mot. Une rotation de la clé
   * maître se terminait sur « 0 secret rechiffré », et le redémarrage sous la
   * nouvelle clé rendait illisibles jetons de node, TOTP et mots de passe.
   */
  it("reprend une valeur au format courant v3", () => {
    const avant = encryptSecret("jeton-du-node", ANCIENNE);
    expect(avant.startsWith("v3:")).toBe(true);

    const apres = rotation.rekey(avant);

    expect(apres).not.toBeNull();
    expect(decryptSecret(apres as string, NOUVELLE)).toBe("jeton-du-node");
  });

  it("reprend une valeur à l'ancien format sans préfixe", () => {
    const [, ...sansPrefixe] = encryptSecret("mot-de-passe-mysql", ANCIENNE).split(":");

    const apres = rotation.rekey(sansPrefixe.join(":"));

    expect(decryptSecret(apres as string, NOUVELLE)).toBe("mot-de-passe-mysql");
  });

  it("laisse en l'état une valeur déjà reprise : relancer ne fait rien", () => {
    const dejaReprise = encryptSecret("secret-totp", NOUVELLE);

    expect(rotation.rekey(dejaReprise)).toBeNull();
  });

  it("reprend un changement de sel à clé maître constante", () => {
    const changementDeSel = createRekeyer({
      fromSecret: NOUVELLE.APP_SECRET_KEY,
      fromSalt: "sel-precedent.v1",
      toSecret: NOUVELLE.APP_SECRET_KEY,
      toSalt: SEL,
    });
    // Une valeur « ancien sel » : on y amène, par le même mécanisme, une
    // valeur que le panel vient d'écrire.
    const source = createRekeyer({
      fromSecret: NOUVELLE.APP_SECRET_KEY,
      fromSalt: SEL,
      toSecret: NOUVELLE.APP_SECRET_KEY,
      toSalt: "sel-precedent.v1",
    }).rekey(encryptSecret("secret-webhook", NOUVELLE));

    const apres = changementDeSel.rekey(source as string);

    expect(decryptSecret(apres as string, NOUVELLE)).toBe("secret-webhook");
  });

  it("ne reconnaît que les deux formes produites par le panel", () => {
    expect(ciphertextParts("v3:a:b:c")).toEqual(["a", "b", "c"]);
    expect(ciphertextParts("a:b:c")).toEqual(["a", "b", "c"]);
    expect(ciphertextParts("v4:a:b:c")).toBeNull();
    expect(ciphertextParts("texte en clair")).toBeNull();
    expect(ciphertextParts("a::c")).toBeNull();
  });
});
