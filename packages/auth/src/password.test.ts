import { describe, expect, it } from "vitest";
import { ARGON2_OPTIONS, hashPassword, needsRehash, verifyPassword } from "./password";

/**
 * Ces cas exécutent un vrai Argon2id, volontairement coûteux : les mesurer avec
 * des paramètres affaiblis ne prouverait rien sur ce qui tourne en production.
 * Le nombre de cas est donc tenu au minimum.
 */
describe("hashPassword", () => {
  it("accepte ensuite le bon mot de passe", async () => {
    const digest = await hashPassword("une phrase de passe correcte");
    expect(await verifyPassword(digest, "une phrase de passe correcte")).toBe(true);
  });

  it("refuse un mot de passe différent", async () => {
    const digest = await hashPassword("une phrase de passe correcte");
    expect(await verifyPassword(digest, "une phrase de passe incorrecte")).toBe(false);
  });

  it("produit un condensat différent à chaque fois", async () => {
    // Le sel est aléatoire : deux comptes ayant le même mot de passe ne doivent
    // pas être reconnaissables par simple comparaison des colonnes.
    const [a, b] = await Promise.all([hashPassword("identique"), hashPassword("identique")]);
    expect(a).not.toBe(b);
  });

  it("ne tronque pas au-delà de 72 octets, contrairement à bcrypt", async () => {
    // C'est la raison du choix d'Argon2id : avec bcrypt, ces deux mots de passe
    // seraient équivalents et la connexion réussirait avec le mauvais.
    const base = "x".repeat(72);
    const digest = await hashPassword(`${base}PREMIER`);
    expect(await verifyPassword(digest, `${base}SECOND`)).toBe(false);
  });

  it("annonce ses paramètres dans le condensat", async () => {
    const digest = await hashPassword("une phrase de passe correcte");
    expect(digest).toContain("$argon2id$");
    expect(digest).toContain(`m=${ARGON2_OPTIONS.memoryCost}`);
  });
});

describe("verifyPassword", () => {
  it("refuse un condensat illisible sans lever d'exception", async () => {
    // Colonne corrompue ou valeur écrite par un autre outil : la connexion doit
    // échouer proprement, pas remonter une erreur 500 au visiteur.
    expect(await verifyPassword("pas-un-condensat", "peu importe")).toBe(false);
    expect(await verifyPassword("", "peu importe")).toBe(false);
  });
});

describe("needsRehash", () => {
  it("ne demande rien pour un condensat produit avec les paramètres courants", async () => {
    expect(needsRehash(await hashPassword("une phrase de passe correcte"))).toBe(false);
  });

  it("réclame un remplacement pour un coût mémoire plus faible", () => {
    // Condensat Argon2id à 64 Kio, très en deçà des 19 Mio actuels.
    const faible =
      "$argon2id$v=19$m=64,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG";
    expect(needsRehash(faible)).toBe(true);
  });

  it("réclame un remplacement pour un nombre de passes plus faible", () => {
    const faible =
      "$argon2id$v=19$m=19456,t=1,p=1$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG";
    expect(needsRehash(faible)).toBe(true);
  });

  it("laisse tranquille un condensat plus coûteux que le réglage courant", () => {
    // Le remplacer par les paramètres courants l'affaiblirait : un condensat
    // n'est périmé que s'il est plus faible, pas parce qu'il diffère.
    const fort =
      "$argon2id$v=19$m=65536,t=4,p=2$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG";
    expect(needsRehash(fort)).toBe(false);
  });

  it("réclame un remplacement pour un autre algorithme de la famille", () => {
    // Argon2i résiste moins bien aux compromis temps-mémoire sur GPU.
    const argon2i =
      "$argon2i$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG";
    expect(needsRehash(argon2i)).toBe(true);
  });

  it("considère un condensat illisible comme à remplacer", () => {
    expect(needsRehash("pas-un-condensat")).toBe(true);
  });
});
