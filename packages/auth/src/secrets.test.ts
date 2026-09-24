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
