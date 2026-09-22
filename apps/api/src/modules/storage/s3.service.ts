import { createHash } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { PlatformSettingsService } from "../admin/platform-settings.service";

/**
 * Dépôt des sauvegardes sur un stockage compatible S3.
 *
 * **L'archive ne passe pas par le panel**, comme pour le transfert entre nodes.
 * Le daemon la pousse directement vers le compartiment, avec des adresses
 * signées que nous fabriquons pour lui. Relayer plusieurs gigaoctets ferait du
 * panel un goulot d'étranglement, et sa moindre coupure interromprait une
 * sauvegarde qui ne le concerne pas.
 *
 * Le panel garde les deux gestes que le daemon ne peut pas faire, faute de
 * connaître nos identifiants : **ouvrir** le dépôt fractionné, et le **clore** —
 * ou l'abandonner. Un dépôt fractionné jamais clos laisse ses morceaux occuper
 * le compartiment, facturés, et invisibles dans la liste des objets ; c'est le
 * genre de fuite qu'on ne découvre qu'à la facture.
 */

/**
 * Taille d'une partie.
 *
 * 100 Mo : au-dessus du minimum imposé par S3 (5 Mo), assez gros pour qu'une
 * sauvegarde de 50 Go tienne en cinq cents parties — la limite est de dix
 * mille — et assez petit pour qu'une partie perdue se renvoie sans tout
 * reprendre.
 */
export const PART_SIZE = 100 * 1024 * 1024;

/**
 * Validité des adresses signées.
 *
 * Six heures : elles doivent couvrir **toute** la durée du dépôt, qui commence
 * quand l'archive est prête et se poursuit tant qu'il reste des parties. Une
 * signature expirée au milieu d'un envoi de 40 Go ferait échouer une sauvegarde
 * aux trois quarts faite.
 */
const SIGNATURE_TTL_SECONDS = 6 * 3600;

export interface UploadTicket {
  uploadId: string;
  parts: string[];
  partSize: number;
}

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);

  constructor(
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {}

  /** Le stockage distant est-il configuré ? Sinon, les sauvegardes restent locales. */
  async isConfigured(): Promise<boolean> {
    return (await this.client()) !== null;
  }

  /**
   * Chemin d'une sauvegarde dans le compartiment.
   *
   * Le serveur puis la sauvegarde, tous deux par identifiant : deux serveurs
   * peuvent porter le même nom, et un nom se change. Un chemin qui contiendrait
   * le nom deviendrait faux au premier renommage, sans que l'archive bouge.
   */
  async keyFor(serverId: string, backupId: string): Promise<string> {
    const prefix = (await this.settings.text("s3.prefix")).replace(/^\/+|\/+$/g, "");
    const path = `${serverId}/${backupId}.tar.gz`;
    return prefix ? `${prefix}/${path}` : path;
  }

  /**
   * Ouvre un dépôt fractionné et signe une adresse par partie.
   *
   * Le nombre de parties est calculé à partir de la taille **annoncée par le
   * daemon**, qui vient de peser l'archive : c'est la seule source possible, le
   * panel n'a pas le fichier. Une partie de plus est signée par sécurité —
   * `Math.ceil` sur une taille au dernier octet près se retrouverait à court si
   * l'archive grossissait entre la pesée et l'envoi.
   */
  async openUpload(key: string, size: number): Promise<UploadTicket | null> {
    const client = await this.client();
    if (!client) return null;

    const bucket = await this.settings.text("s3.bucket");

    const created = await client.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }),
    );
    if (!created.UploadId) return null;

    // Dix mille parties : la limite de S3, et un plafond sur ce qu'une taille
    // annoncée par le daemon peut faire signer ici.
    const count = Math.min(10_000, Math.max(1, Math.ceil(Math.max(size, 1) / PART_SIZE) + 1));
    const parts: string[] = [];

    for (let number = 1; number <= count; number += 1) {
      parts.push(
        await getSignedUrl(
          client,
          new UploadPartCommand({
            Bucket: bucket,
            Key: key,
            UploadId: created.UploadId,
            PartNumber: number,
          }),
          { expiresIn: SIGNATURE_TTL_SECONDS },
        ),
      );
    }

    return { uploadId: created.UploadId, parts, partSize: PART_SIZE };
  }

  /**
   * Recolle les morceaux.
   *
   * Les parties sont **triées par numéro** avant d'être envoyées : S3 refuse une
   * liste désordonnée, et rien ne garantit que le daemon les rapporte dans
   * l'ordre — il les téléverse en parallèle.
   *
   * Les parties sans empreinte sont écartées : ce sont celles que nous avions
   * signées en trop et que le daemon n'a jamais employées.
   */
  async completeUpload(
    key: string,
    uploadId: string,
    parts: readonly { etag: string; partNumber: number }[],
  ): Promise<boolean> {
    const client = await this.client();
    if (!client) return false;

    const usable = parts
      .filter((part) => part.etag !== "" && part.partNumber > 0)
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((part) => ({ ETag: part.etag, PartNumber: part.partNumber }));

    if (usable.length === 0) {
      // Rien à recoller : le dépôt est abandonné plutôt que laissé ouvert, pour
      // que ses morceaux ne restent pas facturés dans le compartiment.
      await this.abortUpload(key, uploadId);
      return false;
    }

    try {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: await this.settings.text("s3.bucket"),
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: usable },
        }),
      );
      return true;
    } catch (error) {
      this.logger.error(`Dépôt S3 non clos pour ${key} : ${describe(error)}`);
      await this.abortUpload(key, uploadId);
      return false;
    }
  }

  /**
   * Abandonne un dépôt.
   *
   * **Jamais silencieux en cas d'échec** : un abandon raté laisse des morceaux
   * facturés et invisibles dans la liste des objets. C'est exactement le genre
   * de fuite qu'on ne découvre qu'à la facture, donc elle mérite une ligne de
   * journal même si personne ne peut agir dans l'instant.
   */
  async abortUpload(key: string, uploadId: string): Promise<void> {
    const client = await this.client();
    if (!client) return;

    try {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: await this.settings.text("s3.bucket"),
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch (error) {
      this.logger.error(
        `Dépôt S3 interrompu mais non nettoyé pour ${key} : ${describe(error)}. ` +
          "Les morceaux déjà déposés restent facturés tant qu'ils ne sont pas supprimés.",
      );
    }
  }

  /**
   * Adresse de téléchargement, signée et brève.
   *
   * Un quart d'heure : le temps de cliquer et de lancer le téléchargement, pas
   * celui de faire circuler l'adresse. Elle donne accès à l'archive entière
   * sans authentification — c'est ce qui permet au navigateur de la tirer
   * directement, et c'est aussi pourquoi elle expire vite.
   */
  async presignDownload(key: string): Promise<string | null> {
    const client = await this.client();
    if (!client) return null;

    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: await this.settings.text("s3.bucket"), Key: key }),
      { expiresIn: 900 },
    );
  }

  /** Supprime une archive. Une sauvegarde effacée du panel doit l'être partout. */
  async remove(key: string): Promise<void> {
    const client = await this.client();
    if (!client) return;

    try {
      await client.send(
        new DeleteObjectCommand({ Bucket: await this.settings.text("s3.bucket"), Key: key }),
      );
    } catch (error) {
      // L'archive reste dans le compartiment : le dire permet de la retrouver,
      // et la ligne du panel est de toute façon déjà partie.
      this.logger.error(`Archive S3 non supprimée pour ${key} : ${describe(error)}`);
    }
  }

  /**
   * Client S3, refabriqué quand la configuration change.
   *
   * `null` quand un réglage indispensable manque : c'est la réponse à « le
   * stockage distant est-il utilisable », et elle fait retomber les sauvegardes
   * sur le disque du node plutôt que d'échouer.
   */
  private cached: { key: string; client: S3Client } | null = null;

  private async client(): Promise<S3Client | null> {
    const [endpoint, region, bucket, accessKeyId, pathStyle] = await Promise.all([
      this.settings.text("s3.endpoint"),
      this.settings.text("s3.region"),
      this.settings.text("s3.bucket"),
      this.settings.text("s3.accessKey"),
      this.settings.boolean("s3.pathStyle"),
    ]);

    const secretAccessKey = await this.settings.secret("s3.secretKey");
    if (!bucket || !accessKeyId || !secretAccessKey) return null;

    // Le secret entre dans la signature du cache, sous condensat : une rotation
    // qui garde le même identifiant d'accès doit produire un nouveau client.
    const secretDigest = createHash("sha256").update(secretAccessKey).digest("hex").slice(0, 16);
    const signature = JSON.stringify({
      endpoint,
      region,
      bucket,
      accessKeyId,
      pathStyle,
      secretDigest,
    });
    if (this.cached?.key === signature) return this.cached.client;

    const client = new S3Client({
      // Vide pour Amazon lui-même : le SDK compose alors l'adresse depuis la
      // région. Un point d'accès imposé à tort enverrait tout vers un service
      // qui n'existe pas.
      ...(endpoint ? { endpoint } : {}),
      region: region || "us-east-1",
      forcePathStyle: pathStyle,
      credentials: { accessKeyId, secretAccessKey },
    });

    this.cached = { key: signature, client };
    return client;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
