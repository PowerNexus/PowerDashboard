import { parseSshPublicKey, type SshKeyProblem } from "@gamedashboard/auth";
import { type Database, sshKeys } from "@gamedashboard/db";
import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/** Une clé telle qu'un écran la montre. Le corps de la clé n'en fait pas partie. */
export interface SshKeySummary {
  id: string;
  name: string;
  algorithm: string;
  fingerprint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Motifs de refus, traduits une fois ici plutôt qu'à chaque appel. */
const PROBLEMS: Record<SshKeyProblem, string> = {
  malformed:
    "Cette ligne n'est pas une clé publique. Collez le contenu d'un fichier « .pub », pas celui de la clé privée.",
  "unsupported-algorithm":
    "Ce type de clé n'est pas accepté. Employez une clé ed25519, ECDSA ou RSA.",
  "invalid-body": "Le corps de la clé est illisible : la ligne a probablement été coupée.",
  "algorithm-mismatch": "Le corps de la clé ne correspond pas au type annoncé.",
};

/**
 * Clés publiques SSH d'un compte.
 *
 * Elles ne servent qu'au SFTP : le panel n'ouvre pas de session shell, et une
 * clé enregistrée ici ne donne accès qu'aux fichiers des serveurs auxquels le
 * compte a déjà droit. Ce n'est pas un accès de plus, c'est un moyen d'entrée
 * de plus sur le même accès.
 */
@Injectable()
export class SshKeyRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async listForUser(userId: string): Promise<SshKeySummary[]> {
    const rows = await this.db
      .select({
        id: sshKeys.id,
        name: sshKeys.name,
        publicKey: sshKeys.publicKey,
        fingerprint: sshKeys.fingerprint,
        createdAt: sshKeys.createdAt,
        lastUsedAt: sshKeys.lastUsedAt,
      })
      .from(sshKeys)
      .where(eq(sshKeys.userId, userId))
      .orderBy(desc(sshKeys.createdAt));

    return rows.map(({ publicKey, ...row }) => ({
      ...row,
      // L'algorithme est relu depuis la clé plutôt que stocké à côté : deux
      // copies de la même vérité finissent par diverger, et c'est la clé qui
      // fait foi.
      algorithm: publicKey.split(/\s+/)[0] ?? "",
    }));
  }

  /**
   * Enregistre une clé.
   *
   * L'empreinte est calculée ici, jamais reçue : une empreinte fournie par le
   * client pourrait désigner une autre clé que celle enregistrée, et c'est
   * l'empreinte qui sert ensuite à reconnaître le porteur.
   */
  async add(userId: string, name: string, line: string): Promise<SshKeySummary> {
    const parsed = parseSshPublicKey(line);
    if (typeof parsed === "string") throw new BadRequestException(PROBLEMS[parsed]);

    const label = name.trim().slice(0, 100) || parsed.comment.slice(0, 100) || parsed.algorithm;

    const [row] = await this.db
      .insert(sshKeys)
      .values({
        userId,
        name: label,
        // Recomposée à partir de ce qui a été lu, sans le commentaire : la
        // ligne d'origine peut porter n'importe quoi après la clé, et ce
        // « n'importe quoi » se retrouverait tel quel dans les écrans.
        publicKey: `${parsed.algorithm} ${parsed.body}`,
        fingerprint: parsed.fingerprint,
      })
      .onConflictDoNothing({ target: [sshKeys.userId, sshKeys.fingerprint] })
      .returning({ id: sshKeys.id, createdAt: sshKeys.createdAt });

    // Aucune ligne rendue : l'unicité a joué. Le dire plutôt que de laisser
    // croire à un ajout qui n'aura pas eu lieu.
    if (!row) throw new ConflictException("Cette clé est déjà enregistrée sur votre compte.");

    return {
      id: row.id,
      name: label,
      algorithm: parsed.algorithm,
      fingerprint: parsed.fingerprint,
      createdAt: row.createdAt,
      lastUsedAt: null,
    };
  }

  /**
   * Retire une clé du compte.
   *
   * Le `userId` est dans la condition et non vérifié après coup : une
   * suppression qui lit d'abord et écrit ensuite laisse une fenêtre où la ligne
   * change de mains entre les deux.
   */
  async remove(userId: string, keyId: string): Promise<boolean> {
    const removed = await this.db
      .delete(sshKeys)
      .where(and(eq(sshKeys.id, keyId), eq(sshKeys.userId, userId)))
      .returning({ id: sshKeys.id });

    return removed.length > 0;
  }

  /**
   * Retrouve une clé par son empreinte, pour l'authentification SFTP.
   *
   * L'empreinte est comparée **dans la requête**, jamais en mémoire : parcourir
   * les clés du compte pour comparer ensuite ferait lire toutes les clés à
   * chaque tentative, y compris celles qui ne mènent nulle part.
   */
  async findByFingerprint(userId: string, fingerprint: string): Promise<{ id: string } | null> {
    const [row] = await this.db
      .select({ id: sshKeys.id })
      .from(sshKeys)
      .where(and(eq(sshKeys.userId, userId), eq(sshKeys.fingerprint, fingerprint)))
      .limit(1);

    return row ?? null;
  }

  /**
   * Note qu'une clé vient de servir.
   *
   * Sans exception si l'écriture échoue : une trace d'usage manquante ne
   * justifie pas de refuser une connexion par ailleurs légitime.
   */
  async markUsed(keyId: string): Promise<void> {
    await this.db
      .update(sshKeys)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(sshKeys.id, keyId));
  }
}
