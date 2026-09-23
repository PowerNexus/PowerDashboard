import { backups, type Database, servers } from "@gamedashboard/db";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { NotificationsService } from "../notifications/notifications.service";
import { S3Service } from "../storage/s3.service";

/** Compte rendu envoyé par Wings à la fin d'une sauvegarde. */
export interface BackupReport {
  checksum?: string;
  checksum_type?: string;
  size?: number;
  successful?: boolean;
  /**
   * Empreintes des parties déposées, pour un dépôt fractionné S3.
   *
   * Le daemon les rapporte parce qu'il ne peut pas clore le dépôt lui-même : il
   * n'a pas nos identifiants, seulement des adresses signées. Absent pour une
   * sauvegarde locale.
   */
  parts?: { etag?: string; part_number?: number }[];
}

/**
 * Enregistrement des comptes rendus de sauvegarde.
 *
 * C'est le seul endroit où une sauvegarde cesse d'être « en cours ». Le panel
 * ne le décide jamais de lui-même : il ne sait pas si l'archive a été écrite,
 * seul le daemon le sait.
 */
@Injectable()
export class RemoteBackupService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(S3Service) private readonly s3: S3Service,
  ) {}

  /**
   * Ouvre un dépôt distant et rend les adresses signées au daemon.
   *
   * Appelée par Wings juste avant d'envoyer l'archive, avec la taille qu'il
   * vient de mesurer. Rend `null` quand le stockage distant n'est plus
   * configuré : la sauvegarde échoue alors (voir la route, dans
   * `RemoteController`).
   *
   * L'identifiant du dépôt est retenu en base, car lui seul permettra de
   * recoller les morceaux — ou de les jeter. Le daemon ne le connaît pas.
   */
  async openUpload(
    nodeId: string,
    backupId: string,
    size: number,
  ): Promise<{ parts: string[]; part_size: number } | null> {
    const [row] = await this.db
      .select({ id: backups.id, serverId: backups.serverId, uploadId: backups.uploadId })
      .from(backups)
      .innerJoin(servers, eq(backups.serverId, servers.id))
      .where(and(eq(backups.id, backupId), eq(servers.nodeId, nodeId)))
      .limit(1);

    if (!row) throw new NotFoundException("Sauvegarde introuvable.");

    /*
     * Un dépôt déjà ouvert est abandonné avant d'en ouvrir un autre.
     *
     * Wings redemande des adresses quand il reprend une sauvegarde après un
     * redémarrage. Sans cet abandon, les morceaux du premier essai resteraient
     * dans le compartiment, facturés et invisibles dans la liste des objets.
     */
    const key = await this.s3.keyFor(row.serverId, row.id);
    if (row.uploadId) await this.s3.abortUpload(key, row.uploadId);

    const ticket = await this.s3.openUpload(key, size);
    if (!ticket) return null;

    await this.db
      .update(backups)
      .set({ disk: "s3", uploadId: ticket.uploadId, updatedAt: new Date().toISOString() })
      .where(eq(backups.id, backupId));

    return { parts: ticket.parts, part_size: ticket.partSize };
  }

  /**
   * Clôt une sauvegarde.
   *
   * La sauvegarde doit appartenir à un serveur **de ce node**. Sans cette
   * condition, un node compromis pourrait marquer réussie une sauvegarde
   * hébergée ailleurs — et la faire restaurer plus tard depuis une archive qui
   * n'existe pas, ou qu'il aurait lui-même fabriquée.
   */
  async complete(nodeId: string, backupId: string, report: BackupReport): Promise<void> {
    const [row] = await this.db
      .select({
        id: backups.id,
        serverId: backups.serverId,
        name: backups.name,
        uploadId: backups.uploadId,
      })
      .from(backups)
      .innerJoin(servers, eq(backups.serverId, servers.id))
      .where(and(eq(backups.id, backupId), eq(servers.nodeId, nodeId)))
      .limit(1);

    if (!row) throw new NotFoundException("Sauvegarde introuvable.");

    let successful = report.successful === true;

    /*
     * Un dépôt fractionné se clôt **ici**, et il se clôt toujours.
     *
     * Réussi, on recolle les morceaux ; raté, on les jette. Ne rien faire
     * laisserait un dépôt ouvert dont les parties restent facturées sans
     * apparaître dans la liste des objets — une fuite qu'on ne découvre qu'à
     * la facture.
     *
     * Et si le recollage échoue, la sauvegarde devient un **échec**, quoi
     * qu'ait dit le daemon : de son point de vue tout est parti, mais aucune
     * archive n'est lisible au bout. L'annoncer réussie promettrait une
     * restauration impossible, ce qui est la pire chose qu'un système de
     * sauvegarde puisse faire.
     */
    if (row.uploadId) {
      const key = await this.s3.keyFor(row.serverId, row.id);

      if (successful) {
        const parts = (report.parts ?? []).map((part) => ({
          etag: typeof part.etag === "string" ? part.etag : "",
          partNumber: typeof part.part_number === "number" ? part.part_number : 0,
        }));
        successful = await this.s3.completeUpload(key, row.uploadId, parts);
      } else {
        await this.s3.abortUpload(key, row.uploadId);
      }
    }

    await this.db
      .update(backups)
      .set({
        isSuccessful: successful,
        // Une taille et une empreinte ne sont retenues que d'une sauvegarde
        // réussie : celles d'un échec décriraient une archive tronquée, et
        // laisseraient croire qu'il y a quelque chose à restaurer.
        bytes: successful ? Math.max(0, Math.trunc(report.size ?? 0)) : 0,
        checksum: successful ? (report.checksum ?? null) : null,
        completedAt: new Date().toISOString(),
        // Le dépôt est clos, dans un sens ou dans l'autre : garder son
        // identifiant ferait tenter un second abandon au prochain passage.
        uploadId: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(backups.id, backupId));

    /**
     * Seul un échec vaut une cloche.
     *
     * Une sauvegarde réussie est ce que le client attend : le lui annoncer à
     * chaque nuit noierait la cloche, et la prochaine notification vraiment
     * importante passerait inaperçue. Un échec, lui, demande une action.
     */
    if (!successful) {
      await this.notifications.notifyServerOwner(row.serverId, {
        type: "backup.failed",
        level: "danger",
        title: "Sauvegarde échouée",
        // Le nom est repris tel quel : sans lui, quelqu'un qui en planifie
        // plusieurs ne sait pas laquelle a échoué. Il manquait.
        body: `La sauvegarde « ${row.name} » ne s'est pas terminée. Vérifiez l'espace disque du serveur, et le stockage distant s'il est configuré.`,
      });
    }
  }
}
