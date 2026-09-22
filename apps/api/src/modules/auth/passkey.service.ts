import { Inject, Injectable } from "@nestjs/common";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { PasskeyRepository } from "./passkey.repository";

/**
 * Cérémonies WebAuthn.
 *
 * La vérification est déléguée à `@simplewebauthn/server`, et c'est un choix
 * assumé, à l'inverse du TOTP écrit à la main juste à côté. Les deux n'ont rien
 * de comparable : TOTP tient en trente lignes figées depuis 2011, WebAuthn
 * demande de décoder du CBOR, d'interpréter des clés COSE, de vérifier des
 * signatures ES256, RS256 et EdDSA, et de suivre une spécification qui bouge
 * encore. Réécrire cela, c'est réécrire les bogues que d'autres ont déjà
 * corrigés — sur le chemin d'authentification.
 */

/**
 * Origine et domaine relais.
 *
 * Fournis par l'appelant, qui les tient de la configuration du panel et non de
 * la requête — voir `relying-party.ts` pour la raison, qui est la protection
 * contre l'hameçonnage. Le `rpID` fait partie de ce que l'authentifiant signe :
 * le changer invalide toutes les clés déjà enregistrées.
 */
export interface RelyingParty {
  /** Nom affiché par le navigateur pendant la cérémonie. */
  name: string;
  /** Le domaine, sans schéma ni port. */
  id: string;
  /** L'origine complète, schéma et port compris. */
  origin: string;
}

@Injectable()
export class PasskeyService {
  constructor(@Inject(PasskeyRepository) private readonly passkeys: PasskeyRepository) {}

  /**
   * Options d'enregistrement.
   *
   * `excludeCredentials` porte les clés déjà connues : sans cette liste, le
   * même authentifiant accepterait d'être enregistré une seconde fois et la
   * personne se retrouverait avec deux entrées pour un seul objet, sans
   * pouvoir deviner laquelle supprimer.
   */
  async registrationOptions(
    rp: RelyingParty,
    user: { id: string; email: string; name: string },
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const existing = await this.passkeys.credentialsForUser(user.id);

    return generateRegistrationOptions({
      rpName: rp.name,
      rpID: rp.id,
      userName: user.email,
      userDisplayName: user.name,
      // `none` : le panel n'a pas à savoir quelle marque de clé est employée,
      // et demander une attestation ferait apparaître un avertissement de
      // confidentialité dans le navigateur pour un renseignement dont on ne
      // ferait rien.
      attestationType: "none",
      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports,
      })),
      authenticatorSelection: {
        // `preferred` et non `required` : une clé de sécurité matérielle sans
        // code PIN reste un second facteur parfaitement valable, et l'exiger
        // écarterait des authentifiants que les gens possèdent déjà.
        userVerification: "preferred",
        // Les clés synchronisées entre appareils comme les clés USB sont
        // acceptées : imposer l'un ou l'autre reviendrait à choisir le matériel
        // des gens à leur place.
        residentKey: "preferred",
      },
    });
  }

  /** Vérifie l'enregistrement et range la clé. Rend `null` si la cérémonie échoue. */
  async verifyRegistration(
    rp: RelyingParty,
    userId: string,
    expectedChallenge: string,
    response: RegistrationResponseJSON,
    label: string,
  ): Promise<boolean> {
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.id,
        // L'écran ne promet pas de vérification de l'utilisateur ; l'exiger ici
        // ferait échouer des clés que la cérémonie a pourtant acceptées.
        requireUserVerification: false,
      });
    } catch {
      // La bibliothèque lève sur une réponse malformée autant que sur une
      // signature fausse. Les deux se soldent par le même refus.
      return false;
    }

    if (!verification.verified || !verification.registrationInfo) return false;

    const { credential } = verification.registrationInfo;
    await this.passkeys.add({
      userId,
      credentialId: credential.id,
      // La clé publique est un tableau d'octets ; base64url pour tenir dans une
      // colonne texte, et parce que c'est déjà la forme des identifiants
      // WebAuthn.
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports ?? [],
      label,
    });

    return true;
  }

  /**
   * Options d'authentification pour un compte donné.
   *
   * `allowCredentials` est renseigné parce que le mot de passe a déjà nommé le
   * compte : le navigateur peut donc désigner directement la bonne clé, plutôt
   * que de demander laquelle employer.
   */
  async authenticationOptions(
    rp: RelyingParty,
    userId: string,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const credentials = await this.passkeys.credentialsForUser(userId);

    return generateAuthenticationOptions({
      rpID: rp.id,
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports,
      })),
      // Second facteur : le mot de passe a déjà été donné, et exiger en plus un
      // code PIN sur la clé écarterait les authentifiants qui n'en ont pas.
      userVerification: "discouraged",
    });
  }

  /**
   * Vérifie une assertion et remonte le compteur.
   *
   * La clé est cherchée **dans les clés de ce compte** : une assertion signée
   * par la clé d'autrui serait sinon vérifiée contre la bonne clé publique et
   * ouvrirait la session du mauvais compte.
   */
  async verifyAuthentication(
    rp: RelyingParty,
    userId: string,
    expectedChallenge: string,
    response: AuthenticationResponseJSON,
  ): Promise<boolean> {
    const stored = await this.passkeys.findCredential(userId, response.id);
    if (!stored) return false;

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.id,
        credential: {
          id: stored.credentialId,
          publicKey: Buffer.from(stored.publicKey, "base64url"),
          counter: stored.counter,
          transports: stored.transports,
        },
        requireUserVerification: false,
      });
    } catch {
      return false;
    }

    if (!verification.verified) return false;

    await this.passkeys.recordUse(stored.id, verification.authenticationInfo.newCounter);
    return true;
  }
}
