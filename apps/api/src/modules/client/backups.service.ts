import { backups, type Database, servers } from "@gamedashboard/db";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, count, desc, eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { S3Service } from "../storage/s3.service";
import { WingsClientService } from "../wings/wings-client.service";
import { WingsTokenService } from "../wings/wings-token.service";

export interface ClientBackup {
  id: string;
  name: string;
  bytes: number;
  checksum: string | null;
  /** `null` tant que le daemon n'a pas rendu compte : la sauvegarde est en cours. */
  isSuccessful: boolean | null;
  isLocked: boolean;
  createdAt: string;
  completedAt: string | null;
}

/**
 * Sauvegardes d'un serveur.
 *
 * Le panel tient le registre, le daemon fait le travail. Les deux moitiés
 * doivent rester cohérentes, et c'est tout l'enjeu : une ligne en base sans
 * archive sur le disque est un mensonge qui ne se découvre qu'au moment d'une
 * restauration — c'est-à-dire au pire moment possible.
 */
@Injectable()
export class BackupsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WingsClientService) private readonly wings: WingsClientService,
    @Inject(WingsTokenService) private readonly tokens: WingsTokenService,
    @Inject(S3Service) private readonly s3: S3Service,
  ) {}

  /**
   * Adresse de téléchargement d'une archive.
   *
   * **Le panel ne relaie jamais les octets.** Il rend une adresse que le
   * navigateur suit lui-même : signée par le compartiment pour une sauvegarde
   * distante, signée pour le daemon quand l'archive est restée sur son disque.
   * Faire transiter plusieurs gigaoctets par le panel en ferait un goulot
   * d'étranglement, pour un fichier qu'il n'a aucune raison de lire.
   *
   * Les deux adresses sont **brèves et à usage étroit**, parce qu'elles
   * donnent accès à l'archive sans authentification : un quart d'heure côté
   * compartiment, une minute et un seul usage côté daemon.
   *
   * Une sauvegarde en cours ou ratée est refusée : il n'y a rien de lisible au
   * bout, et servir un lien vers une archive tronquée ferait restaurer des
   * données incomplètes.
   */
  async downloadUrl(serverId: string, backupId: string, userId: string): Promise<string> {
    const backup = await this.mustFind(serverId, backupId);
    if (backup.isSuccessful !== true) {
      throw new ConflictException("Cette sauvegarde n'est pas terminée, ou a échoué.");
    }

    if (backup.disk === "s3") {
      const url = await this.s3.presignDownload(await this.s3.keyFor(serverId, backupId));
      // Le stockage distant a été retiré des réglages depuis le dépôt : dire
      // que l'archive est inaccessible vaut mieux qu'une adresse qui mènera à
      // une erreur du compartiment.
      if (!url) throw new ConflictException("Le stockage distant n'est plus configuré.");
      return url;
    }

    return this.tokens.backupDownloadGrant(serverId, backupId, userId);
  }

  async list(serverId: string): Promise<ClientBackup[]> {
    const rows = await this.db
      .select()
      .from(backups)
      .where(eq(backups.serverId, serverId))
      .orderBy(desc(backups.createdAt));

    return rows.map(project);
  }

  /** Quota, pour l'afficher sans avoir à recompter côté interface. */
  async quota(serverId: string): Promise<{ used: number; limit: number }> {
    const [[used], [server]] = await Promise.all([
      this.db.select({ n: count() }).from(backups).where(eq(backups.serverId, serverId)),
      this.db.select({ limit: servers.backupLimit }).from(servers).where(eq(servers.id, serverId)),
    ]);
    return { used: used?.n ?? 0, limit: server?.limit ?? 0 };
  }

  /**
   * Lance une sauvegarde.
   *
   * L'ordre est imposé par le contrat du daemon : la ligne est créée d'abord,
   * puisque c'est nous qui fournissons l'identifiant dont Wings se servira pour
   * rendre compte. Si le daemon refuse, la ligne est **retirée** — sans cela,
   * elle resterait indéfiniment « en cours », consommerait le quota, et ne
   * pourrait jamais être supprimée puisqu'aucune archive ne lui correspond.
   */
  async create(serverId: string, name: string, ignore: string[]): Promise<ClientBackup> {
    const { used, limit } = await this.quota(serverId);
    if (used >= limit) {
      throw new ConflictException(
        limit === 0
          ? "Ce serveur n'a pas de quota de sauvegardes."
          : `Quota atteint (${used}/${limit}). Supprimez une sauvegarde avant d'en créer une autre.`,
      );
    }

    const [row] = await this.db
      .insert(backups)
      .values({ serverId, name: name.trim(), ignoredFiles: ignore, disk: "local" })
      .returning();

    if (!row) throw new BadRequestException("Sauvegarde non enregistrée.");

    try {
      await this.wings.createBackup(serverId, row.id, ignore);
    } catch (error) {
      await this.db.delete(backups).where(eq(backups.id, row.id));
      throw error;
    }

    return project(row);
  }

  /**
   * Supprime une sauvegarde, archive comprise.
   *
   * Le daemon est appelé en premier : effacer la ligne d'abord ferait perdre la
   * seule référence à l'archive, qui occuperait le disque du node sans plus
   * apparaître nulle part.
   *
   * Une sauvegarde verrouillée est refusée ici et non seulement dans
   * l'interface : le verrou n'a de valeur que s'il tient face à un appel direct.
   */
  async remove(serverId: string, backupId: string): Promise<void> {
    const backup = await this.mustFind(serverId, backupId);
    if (backup.isLocked) {
      throw new ConflictException("Cette sauvegarde est verrouillée. Déverrouillez-la d'abord.");
    }

    await this.wings.deleteBackup(serverId, backupId);

    /*
     * L'archive distante part aussi.
     *
     * Le daemon ne supprime que ce qu'il détient : une sauvegarde déposée sur
     * le compartiment lui est étrangère, et resterait facturée après avoir
     * disparu de l'écran. Personne ne s'en apercevrait — elle n'apparaît plus
     * nulle part dans le panel.
     */
    if (backup.disk === "s3") {
      await this.s3.remove(await this.s3.keyFor(serverId, backupId));
    }

    await this.db.delete(backups).where(eq(backups.id, backupId));
  }

  async setLocked(serverId: string, backupId: string, locked: boolean): Promise<ClientBackup> {
    await this.mustFind(serverId, backupId);
    const [row] = await this.db
      .update(backups)
      .set({ isLocked: locked })
      .where(eq(backups.id, backupId))
      .returning();

    if (!row) throw new NotFoundException("Sauvegarde introuvable.");
    return project(row);
  }

  /**
   * Restaure une sauvegarde sur le serveur.
   *
   * Une sauvegarde encore en cours ou ratée est refusée : restaurer une archive
   * incomplète écraserait des données valides par des données tronquées, et
   * c'est irréversible.
   */
  async restore(serverId: string, backupId: string, truncate: boolean): Promise<void> {
    const backup = await this.mustFind(serverId, backupId);
    if (backup.isSuccessful !== true) {
      throw new ConflictException(
        backup.isSuccessful === null
          ? "Cette sauvegarde est encore en cours."
          : "Cette sauvegarde a échoué et ne peut pas être restaurée.",
      );
    }
    await this.wings.restoreBackup(serverId, backupId, truncate);
  }

  /**
   * Retrouve une sauvegarde **de ce serveur**.
   *
   * L'identifiant du serveur fait partie de la condition, et n'est pas
   * seulement vérifié après coup : sans cela, quelqu'un ayant le droit de
   * supprimer des sauvegardes sur son propre serveur pourrait supprimer celles
   * d'un autre en changeant un identifiant dans l'URL.
   */
  private async mustFind(serverId: string, backupId: string) {
    const [row] = await this.db
      .select()
      .from(backups)
      .where(and(eq(backups.id, backupId), eq(backups.serverId, serverId)))
      .limit(1);

    if (!row) throw new NotFoundException("Sauvegarde introuvable.");
    return row;
  }
}

function project(row: typeof backups.$inferSelect): ClientBackup {
  return {
    id: row.id,
    name: row.name,
    bytes: row.bytes,
    checksum: row.checksum,
    isSuccessful: row.isSuccessful,
    isLocked: row.isLocked,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}
