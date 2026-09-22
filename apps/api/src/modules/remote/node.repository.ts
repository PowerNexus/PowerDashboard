import { type Database, nodes } from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

export interface NodeIdentity {
  id: string;
  name: string;
  tokenId: string;
  /**
   * Secret chiffré (AES-256-GCM), jamais en clair en base.
   *
   * Chiffré et non haché : Wings emploie le même jeton dans les deux sens, et
   * le panel doit pouvoir le lui présenter (§7.4).
   */
  tokenSecret: string;
  maintenanceMode: boolean;
}

@Injectable()
export class NodeRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Retrouve un node par l'identifiant public de son jeton.
   *
   * C'est ce que permet le format en deux parties de Wings
   * (`Bearer <identifiant>.<secret>`) : une lecture indexée au lieu d'un
   * parcours de toute la flotte à comparer condensat par condensat.
   */
  async findByTokenId(tokenId: string): Promise<NodeIdentity | null> {
    const [row] = await this.db
      .select({
        id: nodes.id,
        name: nodes.name,
        tokenId: nodes.daemonTokenId,
        tokenSecret: nodes.daemonTokenEnc,
        maintenanceMode: nodes.maintenanceMode,
      })
      .from(nodes)
      .where(eq(nodes.daemonTokenId, tokenId))
      .limit(1);

    return row ?? null;
  }

  /**
   * Horodate un signe de vie, sans rien apprendre d'autre.
   *
   * Appelée par la garde à **chaque** appel authentifié du daemon, d'où le
   * garde-fou : Wings envoie plusieurs requêtes par minute, et réécrire la même
   * seconde n'apprend rien à personne. Dix secondes sont très en deçà du seuil
   * qui fait conclure au retard, donc la précision perdue ne change aucune
   * lecture.
   *
   * Le filtre est dans la clause `where` et non dans une lecture préalable :
   * deux requêtes concurrentes du daemon feraient sinon deux écritures, chacune
   * ayant lu avant l'autre.
   */
  async touch(nodeId: string): Promise<void> {
    await this.db
      .update(nodes)
      .set({ lastHeartbeatAt: new Date().toISOString() })
      .where(
        and(
          eq(nodes.id, nodeId),
          or(
            isNull(nodes.lastHeartbeatAt),
            lt(nodes.lastHeartbeatAt, sql`now() - interval '10 seconds'`),
          ),
        ),
      );
  }

  /** Horodate le contact et note la version rapportée par le daemon (§8.1). */
  async recordHeartbeat(nodeId: string, wingsVersion: string | null): Promise<void> {
    await this.db
      .update(nodes)
      .set({
        lastHeartbeatAt: new Date().toISOString(),
        // Une version absente n'écrase pas celle déjà connue : un en-tête
        // illisible ne doit pas faire oublier ce qu'on savait du node.
        ...(wingsVersion ? { wingsVersion } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(nodes.id, nodeId));
  }
}
