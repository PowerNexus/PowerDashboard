import {
  createHash,
  createSign,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
} from "node:crypto";

/**
 * Authentifiant WebAuthn logiciel, **pour les tests uniquement**.
 *
 * Il fabrique de vraies réponses : vraies structures CBOR, vraie clé P-256,
 * vraies signatures ECDSA. C'est ce qui permet d'éprouver la vérification
 * telle qu'elle tournera — un objet simulé rendu par un `vi.fn()` ne prouverait
 * que la capacité du test à se mentir à lui-même.
 *
 * Il ne sert jamais en production et n'est importé que par des tests. Il vit
 * dans `src/` et non dans un fichier de test pour rester lisible et réutilisable
 * par les deux cérémonies.
 */

/** Drapeaux de `authenticatorData`, tels que la spécification les numérote. */
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;

/** Encodage CBOR minimal : juste ce qu'exigent les deux structures employées. */
const cbor = {
  /** Chaîne d'octets. */
  bytes(value: Uint8Array): Buffer {
    const header =
      value.length < 24
        ? Buffer.from([0x40 + value.length])
        : value.length < 256
          ? Buffer.from([0x58, value.length])
          : Buffer.from([0x59, value.length >> 8, value.length & 0xff]);
    return Buffer.concat([header, Buffer.from(value)]);
  },
  /** Chaîne de texte courte. */
  text(value: string): Buffer {
    return Buffer.concat([Buffer.from([0x60 + value.length]), Buffer.from(value, "utf8")]);
  },
  /** Entier positif ou négatif, sur un seul octet. */
  int(value: number): Buffer {
    return Buffer.from([value >= 0 ? value : 0x20 + (-value - 1)]);
  },
  map(entries: Buffer[]): Buffer {
    return Buffer.concat([Buffer.from([0xa0 + entries.length / 2]), ...entries]);
  },
};

export interface SoftwareAuthenticatorOptions {
  /** Domaine relais attendu. Son condensat est inscrit dans `authenticatorData`. */
  rpId: string;
  origin: string;
}

export class SoftwareAuthenticator {
  readonly credentialId: Buffer;
  private readonly privateKey: KeyObject;
  private readonly publicKeyRaw: Buffer;
  private counter = 0;

  constructor(private readonly options: SoftwareAuthenticatorOptions) {
    this.credentialId = randomBytes(32);
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    // Forme non compressée : 0x04 puis X et Y sur 32 octets chacun.
    this.publicKeyRaw = publicKey.export({ format: "der", type: "spki" }).subarray(-65);
  }

  /** Clé publique au format COSE, telle que l'attend un vérificateur WebAuthn. */
  private cosePublicKey(): Buffer {
    const x = this.publicKeyRaw.subarray(1, 33);
    const y = this.publicKeyRaw.subarray(33, 65);
    return cbor.map([
      cbor.int(1), // kty
      cbor.int(2), // EC2
      cbor.int(3), // alg
      cbor.int(-7), // ES256
      cbor.int(-1), // crv
      cbor.int(1), // P-256
      cbor.int(-2),
      cbor.bytes(x),
      cbor.int(-3),
      cbor.bytes(y),
    ]);
  }

  private authenticatorData(withCredential: boolean, userVerified: boolean): Buffer {
    const rpIdHash = createHash("sha256").update(this.options.rpId, "utf8").digest();
    const flags =
      FLAG_USER_PRESENT |
      (userVerified ? FLAG_USER_VERIFIED : 0) |
      (withCredential ? FLAG_ATTESTED_CREDENTIAL_DATA : 0);

    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter, 0);

    if (!withCredential) return Buffer.concat([rpIdHash, Buffer.from([flags]), counter]);

    const credentialIdLength = Buffer.alloc(2);
    credentialIdLength.writeUInt16BE(this.credentialId.length, 0);

    return Buffer.concat([
      rpIdHash,
      Buffer.from([flags]),
      counter,
      // AAGUID à zéro : c'est ce que rend un authentifiant sans attestation.
      Buffer.alloc(16),
      credentialIdLength,
      this.credentialId,
      this.cosePublicKey(),
    ]);
  }

  private clientData(type: "webauthn.create" | "webauthn.get", challenge: string): Buffer {
    return Buffer.from(
      JSON.stringify({ type, challenge, origin: this.options.origin, crossOrigin: false }),
      "utf8",
    );
  }

  /** Réponse d'enregistrement, attestation `none`. */
  register(challenge: string): Record<string, unknown> {
    const authData = this.authenticatorData(true, true);
    const attestationObject = cbor.map([
      cbor.text("fmt"),
      cbor.text("none"),
      cbor.text("attStmt"),
      cbor.map([]),
      cbor.text("authData"),
      cbor.bytes(authData),
    ]);

    return {
      id: this.credentialId.toString("base64url"),
      rawId: this.credentialId.toString("base64url"),
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: this.clientData("webauthn.create", challenge).toString("base64url"),
        attestationObject: attestationObject.toString("base64url"),
        transports: ["usb"],
      },
    };
  }

  /**
   * Réponse d'authentification.
   *
   * Le compteur monte d'une unité à chaque emploi, comme le ferait un vrai
   * authentifiant — c'est ce qui permet d'éprouver la détection de clonage.
   */
  authenticate(challenge: string, options: { counter?: number } = {}): Record<string, unknown> {
    this.counter = options.counter ?? this.counter + 1;
    const authData = this.authenticatorData(false, false);
    const clientDataJSON = this.clientData("webauthn.get", challenge);

    const signed = Buffer.concat([authData, createHash("sha256").update(clientDataJSON).digest()]);
    const signature = createSign("SHA256").update(signed).sign(this.privateKey);

    return {
      id: this.credentialId.toString("base64url"),
      rawId: this.credentialId.toString("base64url"),
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authData.toString("base64url"),
        signature: signature.toString("base64url"),
      },
    };
  }
}
