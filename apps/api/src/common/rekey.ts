import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Le cœur de `scripts/rekey-secrets.mts` : relire une valeur avec l'ancienne
 * clé dérivée, la réécrire avec la nouvelle.
 *
 * Sorti du script pour être éprouvé : le script agit sur la base en une
 * transaction, ce qui ne se teste pas sans elle, alors que tout ce qui peut
 * mal tourner côté chiffrement se joue ici.
 *
 * **N'importe pas `@gamedashboard/auth`**, pour la raison que donne le script :
 * il se lance *avant* la mise en ligne du nouveau code, et ne doit donc pas
 * dépendre de la version déployée de la bibliothèque. Le format est redit
 * ici ; le test vérifie qu'il reste celui que `decryptSecret` sait lire.
 */

export interface RekeyOptions {
  /** Clé maître d'où l'on vient. Égale à `toSecret` pour un simple changement de sel. */
  fromSecret: string;
  fromSalt: string;
  toSecret: string;
  toSalt: string;
}

export interface Rekeyer {
  /**
   * Rend la valeur rechiffrée, ou `null` si elle ne vient pas de l'ancienne
   * clé — déjà reprise, jamais chiffrée, ou liée à un contexte (AAD).
   */
  rekey(payload: string): string | null;
}

/**
 * Découpe une valeur chiffrée en ses trois parties.
 *
 * Deux formes, comme dans `decryptSecret` : `v3:iv:tag:données`, produite
 * aujourd'hui, et `iv:tag:données`, antérieure. Ne reconnaître que la seconde
 * laissait de côté **toute** valeur écrite depuis l'introduction du préfixe :
 * une rotation de la clé maître ne reprenait alors rien, et le panel perdait
 * ses secrets à la bascule de `APP_SECRET_KEY`.
 */
export function ciphertextParts(payload: string): [string, string, string] | null {
  const split = payload.split(":");
  const parts = split.length === 4 && split[0] === "v3" ? split.slice(1) : split;
  if (parts.length !== 3 || parts.some((part) => part === "")) return null;
  return parts as [string, string, string];
}

export function createRekeyer(options: RekeyOptions): Rekeyer {
  const fromKey = scryptSync(options.fromSecret, options.fromSalt, 32);
  const toKey = scryptSync(options.toSecret, options.toSalt, 32);

  function decryptFrom(payload: string): string | null {
    const parts = ciphertextParts(payload);
    if (!parts) return null;
    const [iv, tag, data] = parts;
    try {
      const decipher = createDecipheriv("aes-256-gcm", fromKey, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return (
        decipher.update(Buffer.from(data, "base64url")).toString("utf8") + decipher.final("utf8")
      );
    } catch {
      // GCM authentifie : une valeur qui ne vient pas de l'ancienne clé échoue
      // franchement au lieu de rendre des octets arbitraires.
      return null;
    }
  }

  function encryptTo(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", toKey, iv);
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const parts = [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64url"));
    return `v3:${parts.join(":")}`;
  }

  return {
    rekey(payload) {
      const clear = decryptFrom(payload);
      return clear === null ? null : encryptTo(clear);
    },
  };
}
