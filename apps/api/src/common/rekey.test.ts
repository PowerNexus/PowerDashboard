import { decryptSecret, encryptSecret } from "@gamedashboard/auth";
import { describe, expect, it } from "vitest";
import { createRekeyer, parseCiphertext, REKEY_TARGETS, targetContext } from "./rekey";
import { SECRET_COLUMNS, secretContext } from "./row-secrets";

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

  /*
   * Non-régression : sans longueur de tag imposée, GCM acceptait un tag
   * tronqué. Un chiffré forgé en base avec un tag de quatre octets — trente-
   * deux bits, à la portée d'une recherche exhaustive — ressortait rechiffré
   * avec un tag complet, et devenait indiscernable d'un vrai secret.
   */
  it("refuse une valeur dont le tag a été tronqué", () => {
    const [prefixe, iv, tag, donnees] = encryptSecret("jeton-du-node", ANCIENNE).split(":");
    const court = Buffer.from(tag as string, "base64url")
      .subarray(0, 4)
      .toString("base64url");

    expect(rotation.rekey([prefixe, iv, court, donnees].join(":"))).toBeNull();
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

  it("ne reconnaît que les trois formes produites par le panel", () => {
    const parties = { iv: "a", tag: "b", data: "c" };
    expect(parseCiphertext("v4:a:b:c")).toEqual({ bound: true, ...parties });
    expect(parseCiphertext("v3:a:b:c")).toEqual({ bound: false, ...parties });
    expect(parseCiphertext("a:b:c")).toEqual({ bound: false, ...parties });
    expect(parseCiphertext("v5:a:b:c")).toBeNull();
    expect(parseCiphertext("texte en clair")).toBeNull();
    expect(parseCiphertext("a::c")).toBeNull();
  });
});

/*
 * Non-régression (audit ASVS, NC-18) : le rechiffrement ignorait le contexte.
 * Il ne savait ni lier les valeurs écrites avant la liaison, ni reprendre une
 * valeur liée — une rotation de la clé maître l'aurait laissée sous
 * l'ancienne clé, donc perdue à la bascule.
 */
describe("liaison des secrets à leur ligne", () => {
  const A = "user_credentials_totp.secret_enc:a";
  const B = "user_credentials_totp.secret_enc:b";
  const liaison = createRekeyer({
    fromSecret: NOUVELLE.APP_SECRET_KEY,
    fromSalt: SEL,
    toSecret: NOUVELLE.APP_SECRET_KEY,
    toSalt: SEL,
  });

  it("lie à sa ligne une valeur d'avant la liaison, à clé constante", () => {
    const avant = encryptSecret("secret-totp", NOUVELLE);
    const [, ...sansPrefixe] = avant.split(":");

    for (const valeur of [avant, sansPrefixe.join(":")]) {
      const apres = liaison.rekey(valeur, A) as string;
      expect(apres.startsWith("v4:")).toBe(true);
      expect(decryptSecret(apres, NOUVELLE, A)).toBe("secret-totp");
      // Recopiée sur une autre ligne, elle ne se relit plus.
      expect(() => decryptSecret(apres, NOUVELLE, B)).toThrow();
    }
  });

  it("relancer la liaison ne réécrit rien", () => {
    const liee = encryptSecret("secret-totp", NOUVELLE, A);

    expect(liaison.rekey(liee, A)).toBeNull();
    expect(liaison.isCurrent(liee, A)).toBe(true);
  });

  it("reprend une valeur liée lors d'une rotation, sous le même contexte", () => {
    const apres = rotation.rekey(encryptSecret("jeton-du-node", ANCIENNE, A), A) as string;

    expect(decryptSecret(apres, NOUVELLE, A)).toBe("jeton-du-node");
    expect(() => decryptSecret(apres, ANCIENNE, A)).toThrow();
    expect(rotation.isCurrent(apres, A)).toBe(true);
    // Relancer la rotation ne fait plus rien : la valeur n'est plus sous l'ancienne clé.
    expect(rotation.rekey(apres, A)).toBeNull();
  });

  it("lie et reprend d'un coup une valeur d'avant la liaison lors d'une rotation", () => {
    const apres = rotation.rekey(encryptSecret("mot-de-passe", ANCIENNE), A) as string;

    expect(apres.startsWith("v4:")).toBe(true);
    expect(decryptSecret(apres, NOUVELLE, A)).toBe("mot-de-passe");
  });

  it("lie, lors d'une rotation, une valeur déjà sous la nouvelle clé mais pas encore liée", () => {
    const apres = rotation.rekey(encryptSecret("mot-de-passe", NOUVELLE), A) as string;

    expect(decryptSecret(apres, NOUVELLE, A)).toBe("mot-de-passe");
  });

  it("ne blanchit pas une valeur recopiée d'une autre ligne", () => {
    // La reprise la rechiffrerait sinon sous le contexte de la ligne où elle a
    // été recopiée : la permutation deviendrait indétectable.
    const deB = encryptSecret("secret-de-b", ANCIENNE, B);
    expect(rotation.rekey(deB, A)).toBeNull();
    expect(rotation.isCurrent(deB, A)).toBe(false);

    const deBSousLaNouvelle = encryptSecret("secret-de-b", NOUVELLE, B);
    expect(liaison.rekey(deBSousLaNouvelle, A)).toBeNull();
    expect(liaison.isCurrent(deBSousLaNouvelle, A)).toBe(false);
  });

  it("ne relit pas une valeur liée sans son contexte", () => {
    expect(rotation.rekey(encryptSecret("jeton", ANCIENNE, A))).toBeNull();
  });

  it("reprend chaque colonne chiffrée de l'API, sous le contexte où l'API la relit", () => {
    // Une colonne chiffrée par l'API et absente d'ici serait perdue à la
    // rotation ; reprise sous un autre contexte, elle serait illisible.
    const colonnes = REKEY_TARGETS.map((cible) => `${cible.table}.${cible.column}`);
    expect([...colonnes].sort()).toEqual([...SECRET_COLUMNS].sort());

    for (const cible of REKEY_TARGETS) {
      const colonne = `${cible.table}.${cible.column}` as (typeof SECRET_COLUMNS)[number];
      const contexte = secretContext(colonne, "ligne-1");
      expect(targetContext(cible, "ligne-1")).toBe(contexte);

      const avant = encryptSecret(`secret de ${colonne}`, ANCIENNE, contexte);
      const apres = rotation.rekey(avant, targetContext(cible, "ligne-1")) as string;
      expect(decryptSecret(apres, NOUVELLE, contexte)).toBe(`secret de ${colonne}`);
    }
  });

  it("identifie un réglage par sa clé, comme l'API", () => {
    const reglages = REKEY_TARGETS.find((cible) => cible.table === "settings");
    expect(reglages?.key).toBe("key");
    expect(targetContext(reglages as (typeof REKEY_TARGETS)[number], "smtp.password")).toBe(
      "settings.value:smtp.password",
    );
  });
});
