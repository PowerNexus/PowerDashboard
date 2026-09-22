import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@gamedashboard/auth";
import { type Database, databaseHosts, databases, servers } from "@gamedashboard/db";
import { DEFAULT_MAX_USER_CONNECTIONS } from "@gamedashboard/mysql";
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, count, eq, isNull, or, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { MysqlProvisionerService } from "./mysql-provisioner.service";

export interface ClientDatabase {
  id: string;
  name: string;
  username: string;
  host: string;
  port: number;
  remote: string;
  hostName: string;
  createdAt: string;
}

@Injectable()
export class DatabasesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MysqlProvisionerService) private readonly mysql: MysqlProvisionerService,
  ) {}

  /**
   * Bases d'un serveur.
   *
   * Le mot de passe **n'est jamais** dans cette liste. Il se demande base par
   * base, par une route dédiée : afficher tous les mots de passe à l'ouverture
   * de la page les exposerait à un regard par-dessus l'épaule, à une capture
   * d'écran de support, et au cache du navigateur — pour un besoin qui ne
   * survient qu'une fois.
   */
  async list(serverId: string): Promise<ClientDatabase[]> {
    const rows = await this.db
      .select({
        id: databases.id,
        name: databases.name,
        username: databases.username,
        remote: databases.remote,
        createdAt: databases.createdAt,
        host: databaseHosts.host,
        port: databaseHosts.port,
        hostName: databaseHosts.name,
      })
      .from(databases)
      .innerJoin(databaseHosts, eq(databases.databaseHostId, databaseHosts.id))
      .where(eq(databases.serverId, serverId));

    return rows;
  }

  async quota(serverId: string): Promise<{ used: number; limit: number }> {
    const [[used], [server]] = await Promise.all([
      this.db.select({ n: count() }).from(databases).where(eq(databases.serverId, serverId)),
      this.db
        .select({ limit: servers.databaseLimit })
        .from(servers)
        .where(eq(servers.id, serverId)),
    ]);
    return { used: used?.n ?? 0, limit: server?.limit ?? 0 };
  }

  /** Mot de passe d'une base, déchiffré à la demande. */
  async password(serverId: string, databaseId: string): Promise<string> {
    const row = await this.mustFind(serverId, databaseId);
    return decryptSecret(row.passwordEnc);
  }

  /**
   * Crée une base.
   *
   * L'ordre est délibéré : MySQL d'abord, la ligne du panel ensuite. Une base
   * créée sans ligne est un objet orphelin qu'un administrateur retrouve et
   * supprime ; une ligne sans base est un jeu d'identifiants remis au client
   * qui ne se connectera jamais, sans que rien ne le signale.
   *
   * Le nom réel est préfixé par l'identifiant court du serveur : les hôtes
   * MySQL sont partagés entre clients, et deux serveurs demandant tous deux
   * « survie » doivent obtenir deux bases distinctes.
   */
  async create(serverId: string, suffix: string, remote: string): Promise<ClientDatabase> {
    const { used, limit } = await this.quota(serverId);
    if (used >= limit) {
      throw new ConflictException(
        limit === 0
          ? "Ce serveur n'a pas de quota de bases de données."
          : `Quota atteint (${used}/${limit}).`,
      );
    }

    const [server] = await this.db
      .select({ shortId: servers.uuidShort, nodeId: servers.nodeId })
      .from(servers)
      .where(eq(servers.id, serverId))
      .limit(1);
    if (!server) throw new NotFoundException("Serveur introuvable.");

    const host = await this.pickHost(server.nodeId);
    const name = `s${server.shortId}_${suffix.trim()}`;
    const username = `u${server.shortId}_${randomBytes(3).toString("hex")}`;
    const password = generatePassword();

    await this.mysql.createDatabase(host, name, username, password, remote);

    try {
      const row = await this.db.transaction(async (tx) => {
        /*
         * Le quota est revérifié **sous verrou** au moment d'écrire.
         *
         * Le premier contrôle, plus haut, n'engage à rien : deux demandes
         * simultanées le passaient toutes les deux et dépassaient le plafond
         * d'une base. La ligne du serveur est verrouillée le temps de compter
         * et d'insérer ; la seconde demande attend, recompte, et se voit
         * refuser — sa base MySQL est alors défaite par le `catch` ci-dessous.
         */
        await tx.execute(
          sql`select 1 from ${servers} where ${servers.id} = ${serverId} for update`,
        );
        const [used] = await tx
          .select({ n: count() })
          .from(databases)
          .where(eq(databases.serverId, serverId));
        if ((used?.n ?? 0) >= limit) {
          throw new ConflictException(`Quota atteint (${used?.n ?? 0}/${limit}).`);
        }

        const [inserted] = await tx
          .insert(databases)
          .values({
            serverId,
            databaseHostId: host.id,
            name,
            username,
            passwordEnc: encryptSecret(password),
            remote,
            // Le plafond réellement posé sur l'utilisateur MySQL, noté ici pour que
            // le panel puisse le dire. La colonne existait depuis le début sans
            // que rien ne la remplisse, et sans que rien ne limite non plus.
            maxConnections: DEFAULT_MAX_USER_CONNECTIONS,
          })
          .returning();
        return inserted;
      });
      if (!row) throw new Error("insertion sans résultat");

      return {
        id: row.id,
        name: row.name,
        username: row.username,
        remote: row.remote,
        createdAt: row.createdAt,
        host: host.host,
        port: host.port,
        hostName: host.name,
      };
    } catch (error) {
      // L'enregistrement a échoué après la création réelle : on défait, sinon
      // la base occuperait l'hôte sans apparaître dans le quota du client.
      await this.mysql.dropDatabase(host, name, username, remote).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Régénère le mot de passe.
   *
   * Le nouveau n'est enregistré qu'après confirmation par MySQL : l'inverse
   * ferait afficher au client un mot de passe que le serveur refuserait.
   */
  async rotatePassword(serverId: string, databaseId: string): Promise<string> {
    const row = await this.mustFind(serverId, databaseId);
    const host = await this.hostById(row.databaseHostId);
    const password = generatePassword();

    await this.mysql.rotatePassword(host, row.username, row.remote, password);
    await this.db
      .update(databases)
      .set({ passwordEnc: encryptSecret(password), updatedAt: new Date().toISOString() })
      .where(eq(databases.id, databaseId));

    return password;
  }

  /**
   * Supprime la base.
   *
   * MySQL d'abord ici aussi : retirer la ligne en premier ferait perdre le nom
   * de la base, et plus rien ne permettrait ensuite de la retrouver sur l'hôte.
   */
  async remove(serverId: string, databaseId: string): Promise<void> {
    const row = await this.mustFind(serverId, databaseId);
    const host = await this.hostById(row.databaseHostId);

    await this.mysql.dropDatabase(host, row.name, row.username, row.remote);
    await this.db.delete(databases).where(eq(databases.id, databaseId));
  }

  /**
   * Hôte MySQL à utiliser.
   *
   * Choisi par le panel et jamais par le client : le laisser désigner l'hôte
   * reviendrait à lui faire ouvrir une connexion administrateur vers une
   * machine de son choix.
   *
   * Deux réglages de l'hôte, longtemps écrits sans être lus, s'appliquent
   * ici : un hôte **réservé à un node** ne sert que les serveurs de ce node,
   * et un hôte **plafonné** cesse d'accueillir des bases une fois son nombre
   * atteint. Un hôte propre au node passe avant un hôte partagé.
   */
  private async pickHost(nodeId: string | null) {
    const candidates = await this.db
      .select({ host: databaseHosts, used: count(databases.id) })
      .from(databaseHosts)
      .leftJoin(databases, eq(databases.databaseHostId, databaseHosts.id))
      .where(
        nodeId === null
          ? isNull(databaseHosts.nodeId)
          : or(isNull(databaseHosts.nodeId), eq(databaseHosts.nodeId, nodeId)),
      )
      .groupBy(databaseHosts.id);

    const open = candidates
      .filter(({ host, used }) => host.maxDatabases === null || used < host.maxDatabases)
      .sort((a, b) => Number(b.host.nodeId !== null) - Number(a.host.nodeId !== null));

    const chosen = open[0]?.host;
    if (!chosen) {
      throw new ServiceUnavailableException(
        candidates.length === 0
          ? "Aucun hôte de bases de données n'est configuré pour ce serveur."
          : "Les hôtes de bases de données disponibles sont pleins.",
      );
    }
    return chosen;
  }

  private async hostById(id: string) {
    const [host] = await this.db.select().from(databaseHosts).where(eq(databaseHosts.id, id));
    if (!host) throw new ServiceUnavailableException("Hôte de bases de données introuvable.");
    return host;
  }

  /** L'identifiant du serveur fait partie de la condition (voir `BackupsService`). */
  private async mustFind(serverId: string, databaseId: string) {
    const [row] = await this.db
      .select()
      .from(databases)
      .where(and(eq(databases.id, databaseId), eq(databases.serverId, serverId)))
      .limit(1);

    if (!row) throw new NotFoundException("Base de données introuvable.");
    return row;
  }
}

/**
 * Mot de passe MySQL.
 *
 * 24 octets aléatoires en base64url : assez long pour qu'aucune attaque par
 * essais n'ait de sens, et sans caractère que le client aurait à échapper en
 * le collant dans une chaîne de connexion.
 */
function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}
