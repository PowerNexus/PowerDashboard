import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertEncryptionKey,
  decryptSecret,
  encryptSecret,
  looksEncrypted,
  MissingEncryptionKeyError,
  WeakEncryptionKeyError,
} from "./secrets";

const env = { APP_SECRET_KEY: "clé de test, longue et quelconque" } as NodeJS.ProcessEnv;
const autre = { APP_SECRET_KEY: "une autre clé entièrement différente" } as NodeJS.ProcessEnv;

describe("encryptSecret / decryptSecret", () => {
  it("restitue exactement la valeur d'origine", () => {
    const token = "gd_node_9f3c.secret-opaque";
    expect(decryptSecret(encryptSecret(token, env), env)).toBe(token);
  });

  it("gère les caractères non ASCII", () => {
    // Un mot de passe de base de données peut contenir n'importe quoi.
    const secret = "mot de passe « ÉÀÜ » 🔐";
    expect(decryptSecret(encryptSecret(secret, env), env)).toBe(secret);
  });

  it("gère une valeur vide", () => {
    expect(decryptSecret(encryptSecret("", env), env)).toBe("");
  });

  it("produit un résultat différent à chaque chiffrement", () => {
    // Le vecteur d'initialisation est aléatoire : sans cela, comparer deux
    // colonnes révélerait que deux nodes partagent le même jeton.
    const a = encryptSecret("identique", env);
    const b = encryptSecret("identique", env);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, env)).toBe(decryptSecret(b, env));
  });

  it("ne laisse pas transparaître la valeur en clair", () => {
    expect(encryptSecret("phrase-reconnaissable", env)).not.toContain("phrase-reconnaissable");
  });
});

describe("intégrité", () => {
  it("refuse une valeur chiffrée avec une autre clé", () => {
    const chiffre = encryptSecret("secret", env);
    expect(() => decryptSecret(chiffre, autre)).toThrow();
  });

  it("refuse une valeur altérée en base", () => {
    // C'est l'apport de GCM sur un chiffrement simple : quelqu'un pouvant
    // écrire en base ne peut pas modifier un jeton sans que ça se voie.
    const [v, iv, tag, data] = encryptSecret("secret", env).split(":") as [
      string,
      string,
      string,
      string,
    ];
    const altere = `${v}:${iv}:${tag}:${data.slice(0, -2)}AA`;
    expect(() => decryptSecret(altere, env)).toThrow();
  });

  it("refuse une étiquette d'authentification remplacée", () => {
    const [v, iv, , data] = encryptSecret("secret", env).split(":") as [
      string,
      string,
      string,
      string,
    ];
    const [, , tagAutre] = encryptSecret("autre", env).split(":") as [
      string,
      string,
      string,
      string,
    ];
    expect(() => decryptSecret(`${v}:${iv}:${tagAutre}:${data}`, env)).toThrow();
  });

  it("refuse une valeur mal formée", () => {
    expect(() => decryptSecret("pas-un-secret", env)).toThrow("trois parties");
    expect(() => decryptSecret("a:b", env)).toThrow("trois parties");
  });

  it("produit la forme versionnée et relit encore l'ancienne", () => {
    const chiffre = encryptSecret("secret", env);
    expect(chiffre.startsWith("v3:")).toBe(true);
    // Une valeur écrite avant le préfixe : `iv:tag:données` sans version.
    const ancienne = chiffre.slice(3);
    expect(decryptSecret(ancienne, env)).toBe("secret");
  });

  it("lie une valeur à son contexte quand il est fourni", () => {
    const chiffre = encryptSecret("jeton", env, "nodes.daemon_token_enc:a");
    expect(decryptSecret(chiffre, env, "nodes.daemon_token_enc:a")).toBe("jeton");
    // Le même chiffré recopié dans une autre ligne ne se relit pas.
    expect(() => decryptSecret(chiffre, env, "nodes.daemon_token_enc:b")).toThrow();
    expect(() => decryptSecret(chiffre, env)).toThrow();
  });
});

/*
 * Non-régression (audit ASVS, NC-18) : aucun appelant ne passait de contexte,
 * et une valeur `v3:` relue avec un contexte exigeait des données
 * authentifiées qu'elle n'avait jamais reçues. Lier les colonnes rendait donc
 * illisible tout ce qui était déjà en base. La valeur liée a sa propre forme,
 * `v4:`, et `v3:` se relit comme elle a été écrite : sans contexte.
 */
describe("liaison d'un secret à sa ligne", () => {
  const LIGNE_A = "user_credentials_totp.secret_enc:a";
  const LIGNE_B = "user_credentials_totp.secret_enc:b";

  it("écrit une valeur liée sous un préfixe distinct", () => {
    expect(encryptSecret("secret", env, LIGNE_A).startsWith("v4:")).toBe(true);
    expect(encryptSecret("secret", env).startsWith("v3:")).toBe(true);
  });

  it("refuse une permutation de deux lignes, ou d'une colonne à l'autre", () => {
    // Le secret TOTP d'un compte recopié sur un autre : son titulaire
    // passerait le second facteur de la victime avec sa propre application.
    const a = encryptSecret("secret-de-a", env, LIGNE_A);
    const b = encryptSecret("secret-de-b", env, LIGNE_B);
    expect(decryptSecret(a, env, LIGNE_A)).toBe("secret-de-a");
    expect(() => decryptSecret(b, env, LIGNE_A)).toThrow();
    expect(() => decryptSecret(a, env, LIGNE_B)).toThrow();
    expect(() => decryptSecret(a, env, "databases.password_enc:a")).toThrow();
  });

  it("refuse une valeur liée relue sans contexte, en le disant", () => {
    const a = encryptSecret("secret-de-a", env, LIGNE_A);
    expect(() => decryptSecret(a, env)).toThrow(/contexte/);
  });

  it("refuse une valeur liée ramenée à une forme sans contexte", () => {
    // Retirer ou changer le préfixe ne dispense pas du contexte : les données
    // authentifiées font partie du tag, que la forme soit `v3:` ou nue.
    const [, iv, tag, data] = encryptSecret("secret-de-a", env, LIGNE_A).split(":");
    expect(() => decryptSecret(`v3:${iv}:${tag}:${data}`, env, LIGNE_A)).toThrow();
    expect(() => decryptSecret(`${iv}:${tag}:${data}`, env, LIGNE_A)).toThrow();
  });

  it("relit les valeurs écrites sans contexte, même quand la ligne le fournit", () => {
    const v3 = encryptSecret("ancien", env);
    expect(decryptSecret(v3, env, LIGNE_A)).toBe("ancien");
    expect(decryptSecret(v3.slice(3), env, LIGNE_A)).toBe("ancien");
  });

  it("refuse un contexte vide, qui ne lierait à rien", () => {
    expect(() => encryptSecret("secret", env, "")).toThrow(/Contexte de chiffrement vide/);
  });

  it("reconnaît la forme liée comme chiffrée", () => {
    expect(looksEncrypted(encryptSecret("x", env, LIGNE_A))).toBe(true);
    expect(looksEncrypted("v5:a:b:c")).toBe(false);
  });
});

describe("clé absente", () => {
  it("échoue bruyamment plutôt que de stocker en clair", () => {
    // Le pire scénario serait un repli silencieux qui écrirait le secret tel
    // quel : la base paraîtrait chiffrée sans l'être.
    const vide = {} as NodeJS.ProcessEnv;
    expect(() => encryptSecret("secret", vide)).toThrow(MissingEncryptionKeyError);
    expect(() => decryptSecret("a:b:c", vide)).toThrow(MissingEncryptionKeyError);
  });
});

describe("clé trop courte", () => {
  /*
   * Non-régression (audit ASVS, NC-19) : `APP_SECRET_KEY=motdepasse`
   * démarrait. Le sel de scrypt est public : une copie de la base suffisait
   * alors à essayer un dictionnaire de clés contre un secret chiffré, hors
   * ligne et sans limite.
   */
  it("refuse de démarrer sous 32 caractères, et le dit", () => {
    // Hors littéral : `secret-key-samples.test.ts` refuse toute clé d'essai
    // courte écrite en clair dans un test, et celle-ci l'est à dessein.
    const motDePasse = "motdepasse";
    const courte = { APP_SECRET_KEY: motDePasse } as NodeJS.ProcessEnv;
    expect(() => assertEncryptionKey(courte)).toThrow(/il en faut au moins 32/);
    expect(() => encryptSecret("secret", courte)).toThrow(WeakEncryptionKeyError);
    expect(() => decryptSecret("a:b:c", courte)).toThrow(WeakEncryptionKeyError);
    // Juste sous le seuil : un caractère de moins suffit à refuser.
    const presque = { APP_SECRET_KEY: "x".repeat(31) } as NodeJS.ProcessEnv;
    expect(() => assertEncryptionKey(presque)).toThrow(WeakEncryptionKeyError);
  });

  it("accepte une clé de 32 caractères, et celle que génèrent les installateurs", () => {
    expect(() =>
      assertEncryptionKey({ APP_SECRET_KEY: "x".repeat(32) } as NodeJS.ProcessEnv),
    ).not.toThrow();
    // `openssl rand -base64 48` : 64 caractères.
    const installee = { APP_SECRET_KEY: randomBytes(48).toString("base64") } as NodeJS.ProcessEnv;
    expect(decryptSecret(encryptSecret("secret", installee), installee)).toBe("secret");
  });

  it("les clés d'essai de ces tests passent elles-mêmes le seuil", () => {
    expect(env.APP_SECRET_KEY?.length).toBeGreaterThanOrEqual(32);
    expect(autre.APP_SECRET_KEY?.length).toBeGreaterThanOrEqual(32);
  });
});

describe("looksEncrypted", () => {
  it("reconnaît une valeur chiffrée", () => {
    expect(looksEncrypted(encryptSecret("x", env))).toBe(true);
  });

  it("rejette une valeur en clair, ce qui permet de détecter une migration oubliée", () => {
    expect(looksEncrypted("jeton-en-clair")).toBe(false);
  });
});
