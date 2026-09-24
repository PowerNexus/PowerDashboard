import { randomUUID } from "node:crypto";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashPassword,
  hashToken,
  normalizeRecoveryCode,
  tokensMatch,
  verifyPassword,
  verifyTotp,
} from "@gamedashboard/auth";
import {
  type Database,
  userPasskeys,
  userRecoveryCodes,
  users,
  userTotpCredentials,
} from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { decryptRowSecret, encryptRowSecret } from "../../common/row-secrets";

/** État de la double authentification, tel qu'un écran le montre. */
export interface TwoFactorStatus {
  /**
   * Vrai dès qu'une seconde preuve est exigée à la connexion.
   *
   * Un secret TOTP vérifié **ou** au moins une clé d'accès suffit. C'est une
   * question de fait et non de réglage : ce qui compte est qu'on ne puisse
   * plus entrer avec le seul mot de passe.
   */
  enabled: boolean;
  /** Vrai quand un secret TOTP existe mais n'a jamais été confirmé par un code. */
  pending: boolean;
  /** Vrai quand un secret TOTP confirmé est en place. */
  totp: boolean;
  /** Nombre de clés d'accès enregistrées. */
  passkeys: number;
  /** Codes de secours encore utilisables. Zéro est un état à signaler, pas à taire. */
  remainingRecoveryCodes: number;
  /** Date de confirmation du TOTP. `null` quand seule une clé d'accès protège le compte. */
  enabledAt: string | null;
}

/**
 * Le secret TOTP et les codes de secours.
 *
 * Deux traitements opposés pour deux besoins opposés, et c'est délibéré :
 *
 * - le secret TOTP est **chiffré**, parce qu'il faut le relire à chaque
 *   connexion pour recalculer le code attendu ;
 * - les codes de secours sont **hachés**, parce qu'on ne les relit jamais : on
 *   se contente de comparer ce qui est saisi. Les chiffrer offrirait à une
 *   fuite de base la liste complète des codes valides.
 */
@Injectable()
export class TwoFactorRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async status(userId: string): Promise<TwoFactorStatus> {
    const [credential] = await this.db
      .select({ verifiedAt: userTotpCredentials.verifiedAt })
      .from(userTotpCredentials)
      .where(eq(userTotpCredentials.userId, userId))
      .limit(1);

    const remaining = await this.db
      .select({ id: userRecoveryCodes.id })
      .from(userRecoveryCodes)
      .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));

    const passkeys = await this.db
      .select({ id: userPasskeys.id })
      .from(userPasskeys)
      .where(eq(userPasskeys.userId, userId));

    const totp = credential?.verifiedAt != null;
    return {
      enabled: totp || passkeys.length > 0,
      pending: credential != null && credential.verifiedAt == null,
      totp,
      passkeys: passkeys.length,
      remainingRecoveryCodes: remaining.length,
      enabledAt: credential?.verifiedAt ?? null,
    };
  }

  /**
   * Garantit l'existence d'un lot de codes de secours.
   *
   * Appelé à la pose de la **première** seconde preuve, quelle qu'elle soit :
   * sans cela, enregistrer une clé d'accès et rien d'autre reviendrait à parier
   * son compte sur un seul objet physique. Rend les codes seulement s'il a
   * fallu les créer — il n'y a rien à réafficher quand ils existaient déjà, et
   * on ne peut de toute façon pas les relire.
   */
  async ensureRecoveryCodes(userId: string): Promise<string[] | null> {
    const existing = await this.db
      .select({ id: userRecoveryCodes.id })
      .from(userRecoveryCodes)
      .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)))
      .limit(1);

    return existing.length > 0 ? null : this.resetRecoveryCodes(userId);
  }

  /**
   * Prépare un secret non encore confirmé et le rend en clair.
   *
   * C'est la seule fois où il sort : il faut bien l'afficher pour qu'on le
   * recopie dans son application. Une préparation déjà en cours est
   * **remplacée** — quelqu'un qui reprend l'installation après avoir fermé
   * l'onglet doit repartir du secret qu'il voit à l'écran, pas d'un ancien
   * qu'il n'a plus.
   */
  async beginSetup(userId: string): Promise<string> {
    const secret = generateTotpSecret();
    const now = new Date().toISOString();

    await this.db
      .delete(userTotpCredentials)
      .where(and(eq(userTotpCredentials.userId, userId), isNull(userTotpCredentials.verifiedAt)));

    // Identifiant tiré ici : le secret est lié à sa ligne dès l'écriture.
    const id = randomUUID();
    await this.db.insert(userTotpCredentials).values({
      id,
      userId,
      secretEnc: encryptRowSecret("user_credentials_totp.secret_enc", id, secret),
      createdAt: now,
      updatedAt: now,
    });

    return secret;
  }

  /**
   * Confirme la préparation avec un premier code.
   *
   * Exiger ce code n'est pas une formalité : sans lui, on activerait une
   * protection reposant sur un secret peut-être mal recopié, et on s'en
   * apercevrait à la connexion suivante — enfermé dehors.
   */
  async confirmSetup(userId: string, code: string): Promise<boolean> {
    const [credential] = await this.db
      .select({ id: userTotpCredentials.id, secretEnc: userTotpCredentials.secretEnc })
      .from(userTotpCredentials)
      .where(and(eq(userTotpCredentials.userId, userId), isNull(userTotpCredentials.verifiedAt)))
      .limit(1);

    if (!credential) return false;

    const result = verifyTotp(
      decryptRowSecret("user_credentials_totp.secret_enc", credential.id, credential.secretEnc),
      code,
    );
    if (!result.valid) return false;

    const now = new Date().toISOString();
    await this.db
      .update(userTotpCredentials)
      .set({ verifiedAt: now, lastUsedStep: result.step, updatedAt: now })
      .where(eq(userTotpCredentials.id, credential.id));

    await this.setFlag(userId, true);

    return true;
  }

  /**
   * Vérifie un code à la connexion et consomme le pas.
   *
   * L'écriture du pas consommé fait partie de la vérification et non d'un
   * ménage ultérieur : entre les deux, le même code passerait une seconde fois.
   */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const [credential] = await this.db
      .select({
        id: userTotpCredentials.id,
        secretEnc: userTotpCredentials.secretEnc,
        lastUsedStep: userTotpCredentials.lastUsedStep,
      })
      .from(userTotpCredentials)
      .where(eq(userTotpCredentials.userId, userId))
      .limit(1);

    if (!credential) return false;

    const secret = decryptRowSecret(
      "user_credentials_totp.secret_enc",
      credential.id,
      credential.secretEnc,
    );
    const result = verifyTotp(secret, code, {
      lastUsedStep: credential.lastUsedStep,
    });
    if (!result.valid) return false;

    await this.db
      .update(userTotpCredentials)
      .set({ lastUsedStep: result.step, updatedAt: new Date().toISOString() })
      .where(eq(userTotpCredentials.id, credential.id));

    return true;
  }

  /**
   * Consomme un code de secours.
   *
   * Un code servi est marqué, jamais supprimé : la ligne prouve qu'il a servi
   * et quand. C'est ce qui permet de constater après coup qu'un code de secours
   * a été employé alors qu'on n'a rien fait.
   */
  async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const normalized = normalizeRecoveryCode(code);

    /*
     * Les codes sont hachés en Argon2id, pas en SHA-256 : dix caractères sur
     * trente-deux font cinquante bits, ce qu'une carte graphique parcourt en
     * quelques heures sur un condensat rapide. Il faut donc comparer un à un
     * les codes encore valides du compte — dix au plus, sur une route déjà
     * limitée. Les lots antérieurs, en SHA-256, restent reconnus jusqu'à leur
     * régénération : un utilisateur ne doit pas perdre ses codes imprimés
     * parce que le format a changé.
     */
    const candidates = await this.db
      .select({ id: userRecoveryCodes.id, codeHash: userRecoveryCodes.codeHash })
      .from(userRecoveryCodes)
      .where(and(eq(userRecoveryCodes.userId, userId), isNull(userRecoveryCodes.usedAt)));

    const legacyHash = hashToken(normalized);
    let matched: string | null = null;
    for (const candidate of candidates) {
      const match = candidate.codeHash.startsWith("$argon2")
        ? await verifyPassword(candidate.codeHash, normalized)
        : tokensMatch(candidate.codeHash, legacyHash);
      if (match) {
        matched = candidate.id;
        break;
      }
    }
    if (matched === null) return false;

    const rows = await this.db
      .update(userRecoveryCodes)
      .set({ usedAt: new Date().toISOString() })
      .where(
        and(
          eq(userRecoveryCodes.id, matched),
          // Sans cette condition, un code déjà consommé repasserait
          // indéfiniment : la mise à jour réussirait en réécrivant la date.
          isNull(userRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: userRecoveryCodes.id });

    return rows.length > 0;
  }

  /**
   * Remplace le lot de codes de secours et rend les nouveaux en clair.
   *
   * Les anciens sont effacés, y compris ceux qui n'avaient pas servi : un lot
   * régénéré parce qu'on soupçonne une fuite ne vaudrait rien si l'ancien
   * restait valable à côté.
   */
  async resetRecoveryCodes(userId: string): Promise<string[]> {
    const codes = generateRecoveryCodes();
    const now = new Date().toISOString();

    const hashes = await Promise.all(
      codes.map((code) => hashPassword(normalizeRecoveryCode(code))),
    );

    await this.db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
    await this.db.insert(userRecoveryCodes).values(
      hashes.map((codeHash) => ({
        userId,
        codeHash,
        createdAt: now,
        updatedAt: now,
      })),
    );

    return codes;
  }

  /**
   * Retire le secret TOTP.
   *
   * Les clés d'accès ne sont pas touchées : ce sont deux preuves
   * indépendantes, et retirer l'une ne doit pas retirer l'autre à l'insu de
   * son propriétaire. Les codes de secours ne disparaissent que si plus rien
   * ne les rend utiles — c'est à l'appelant de le dire.
   */
  async disableTotp(userId: string, dropRecoveryCodes: boolean): Promise<void> {
    await this.db.delete(userTotpCredentials).where(eq(userTotpCredentials.userId, userId));
    if (dropRecoveryCodes) {
      await this.db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
    }
    await this.setFlag(userId, !dropRecoveryCodes);
  }

  /**
   * Met à jour le drapeau `is_2fa_enabled`.
   *
   * Ce drapeau n'est pas la vérité — la vérité est l'existence d'un secret
   * vérifié ou d'une clé — mais il évite une jointure sur chaque écran
   * d'administration qui affiche la colonne « 2FA ».
   */
  async setFlag(userId: string, enabled: boolean): Promise<void> {
    await this.db
      .update(users)
      .set({ isTwoFactorEnabled: enabled, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId));
  }

  /** Efface les codes de secours. Employé quand plus aucune preuve ne subsiste. */
  async dropRecoveryCodes(userId: string): Promise<void> {
    await this.db.delete(userRecoveryCodes).where(eq(userRecoveryCodes.userId, userId));
  }
}
