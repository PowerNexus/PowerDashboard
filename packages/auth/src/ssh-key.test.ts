import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSshPublicKey } from "./ssh-key";

/** Une vraie clé ed25519, au format `authorized_keys`. */
function realKey(comment = "matheo@codiax"): string {
  const { publicKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" });
  // Les 32 derniers octets du SPKI ed25519 sont la clé brute.
  const raw = der.subarray(der.length - 32);
  const body = Buffer.concat([
    length("ssh-ed25519"),
    Buffer.from("ssh-ed25519"),
    length(raw),
    raw,
  ]).toString("base64");

  return `ssh-ed25519 ${body} ${comment}`;
}

function length(value: string | Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(Buffer.byteLength(value as string), 0);
  return header;
}

describe("lecture d'une clé publique", () => {
  it("lit une clé ed25519 et en tire une empreinte OpenSSH", () => {
    const parsed = parseSshPublicKey(realKey());
    if (typeof parsed === "string") throw new Error(`refusée : ${parsed}`);

    expect(parsed.algorithm).toBe("ssh-ed25519");
    expect(parsed.comment).toBe("matheo@codiax");
    // Format de `ssh-keygen -lf` : pas de remplissage, 43 caractères.
    expect(parsed.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });

  it("donne la même empreinte quel que soit le commentaire", () => {
    // Le commentaire n'est pas la clé : deux lignes qui n'en diffèrent que par
    // là désignent le même secret, et l'une ne doit pas passer pour une
    // seconde clé.
    const key = realKey("poste");
    const [algorithm, body] = key.split(" ");
    const first = parseSshPublicKey(key);
    const second = parseSshPublicKey(`${algorithm} ${body} autre-machine`);

    if (typeof first === "string" || typeof second === "string") throw new Error("refusée");
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it("refuse ce qui n'est pas une clé, en disant quoi", () => {
    expect(parseSshPublicKey("")).toBe("malformed");
    expect(parseSshPublicKey("ssh-ed25519")).toBe("malformed");
    // DSA est cassé et refusé par OpenSSH : l'accepter proposerait une porte
    // que le serveur d'en face n'ouvrira pas.
    expect(parseSshPublicKey("ssh-dss AAAA test")).toBe("unsupported-algorithm");
    expect(parseSshPublicKey("ssh-ed25519 pas-du-base64!! test")).toBe("invalid-body");
  });

  it("refuse une clé dont le corps annonce un autre algorithme", () => {
    // Le corps répète l'algorithme. Sans ce contrôle, l'empreinte porterait sur
    // un corps que le client ne proposera jamais sous ce nom, et la connexion
    // échouerait sans motif visible.
    const [, body] = realKey().split(" ");
    expect(parseSshPublicKey(`ssh-rsa ${body} test`)).toBe("algorithm-mismatch");
  });

  it("refuse une clé collée avec les options d'authorized_keys", () => {
    // `command="…" ssh-ed25519 …` : la ligne vient d'un fichier qu'on n'a pas
    // lu, et ses options ne veulent rien dire ici.
    const key = realKey();
    expect(parseSshPublicKey(`no-pty ${key}`)).toBe("unsupported-algorithm");
  });
});
