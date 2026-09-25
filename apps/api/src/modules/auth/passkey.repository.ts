import { type Database, userPasskeys } from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, type SQL } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/** Clé d'accès telle qu'un écran la montre. La clé publique n'en fait pas partie. */
export interface PasskeySummary {
  id: string;
  label: string;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
  /** Domaine du revendeur où la clé a été créée, `null` pour la plateforme. */
  domain: string | null;
}

/** Ce que la vérification d'une assertion a besoin de retrouver. */
export interface StoredPasskey {
  id: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
}

@Injectable()
export class PasskeyRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Clés d'un compte, la plus récemment employée en tête.
   *
   * Ni `credentialId` ni `publicKey` ne sortent : ils n'apprennent rien à
   * l'utilisateur et alimenteraient un recoupement entre sites pour qui lirait
   * la réponse.
   */
  async listForUser(userId: string): Promise<PasskeySummary[]> {
    return this.db
      .select({
        id: userPasskeys.id,
        label: userPasskeys.label,
        transports: userPasskeys.transports,
        createdAt: userPasskeys.createdAt,
        lastUsedAt: userPasskeys.lastUsedAt,
        domain: userPasskeys.rpId,
      })
      .from(userPasskeys)
      .where(eq(userPasskeys.userId, userId))
      .orderBy(desc(userPasskeys.createdAt));
  }

  /** Clés exploitables pour une cérémonie, avec de quoi vérifier une signature. */
  async credentialsForUser(userId: string, scope: string | null): Promise<StoredPasskey[]> {
    return this.db
      .select({
        id: userPasskeys.id,
        credentialId: userPasskeys.credentialId,
        publicKey: userPasskeys.publicKey,
        counter: userPasskeys.counter,
        transports: userPasskeys.transports,
      })
      .from(userPasskeys)
      .where(and(eq(userPasskeys.userId, userId), inScope(scope)));
  }

  /** Nombre de clés utilisables dans une portée : ce que l'écran de connexion propose. */
  async countInScope(userId: string, scope: string | null): Promise<number> {
    return (await this.credentialsForUser(userId, scope)).length;
  }

  /**
   * Retrouve une clé par son identifiant d'authentifiant.
   *
   * La recherche porte aussi sur le compte : sans cela, une assertion signée
   * par la clé d'autrui serait vérifiée contre la bonne clé publique et
   * ouvrirait la session du mauvais compte.
   */
  async findCredential(
    userId: string,
    credentialId: string,
    scope: string | null,
  ): Promise<StoredPasskey | null> {
    const [row] = await this.db
      .select({
        id: userPasskeys.id,
        credentialId: userPasskeys.credentialId,
        publicKey: userPasskeys.publicKey,
        counter: userPasskeys.counter,
        transports: userPasskeys.transports,
      })
      .from(userPasskeys)
      .where(
        and(
          eq(userPasskeys.userId, userId),
          eq(userPasskeys.credentialId, credentialId),
          inScope(scope),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async add(input: {
    userId: string;
    credentialId: string;
    publicKey: string;
    counter: number;
    transports: string[];
    label: string;
    rpId: string | null;
  }): Promise<void> {
    const now = new Date().toISOString();
    await this.db.insert(userPasskeys).values({ ...input, createdAt: now, updatedAt: now });
  }

  /**
   * Enregistre le compteur et la date d'emploi après une authentification.
   *
   * Le compteur est le garde-fou anti-clonage de WebAuthn : un authentifiant
   * dupliqué finit par présenter une valeur qu'on a déjà vue. Ne pas le
   * remonter reviendrait à désactiver ce contrôle.
   */
  async recordUse(id: string, counter: number): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .update(userPasskeys)
      .set({ counter, lastUsedAt: now, updatedAt: now })
      .where(eq(userPasskeys.id, id));
  }

  /** Renomme une clé. La condition sur le compte empêche de toucher celle d'un autre. */
  async rename(userId: string, id: string, label: string): Promise<boolean> {
    const rows = await this.db
      .update(userPasskeys)
      .set({ label, updatedAt: new Date().toISOString() })
      .where(and(eq(userPasskeys.id, id), eq(userPasskeys.userId, userId)))
      .returning({ id: userPasskeys.id });
    return rows.length > 0;
  }

  /**
   * Supprime une clé.
   *
   * Suppression et non révocation, contrairement aux sessions : une clé
   * conservée resterait dans `excludeCredentials` et empêcherait de
   * réenregistrer le même authentifiant, sans que rien ne l'explique.
   */
  async remove(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(userPasskeys)
      .where(and(eq(userPasskeys.id, id), eq(userPasskeys.userId, userId)))
      .returning({ id: userPasskeys.id });
    return rows.length > 0;
  }

  async removeAllForUser(userId: string): Promise<void> {
    await this.db.delete(userPasskeys).where(eq(userPasskeys.userId, userId));
  }
}

/** Condition « clé de cette portée » : `null` désigne le domaine de la plateforme. */
function inScope(scope: string | null): SQL {
  return scope === null ? isNull(userPasskeys.rpId) : eq(userPasskeys.rpId, scope);
}
