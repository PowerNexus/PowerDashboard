import { createHash } from "node:crypto";
import {
  BRAND_IMAGE_MAX_BYTES,
  type BrandImageKind,
  brandImageIdOf,
  brandImagePath,
  isBrandImageId,
  PLATFORM_BRAND_SETTINGS,
  sniffBrandImage,
} from "@gamedashboard/contracts";
import { brandImages, type Database, resellerBrandings, settings } from "@gamedashboard/db";
import { BadRequestException, Inject, Injectable, PayloadTooLargeException } from "@nestjs/common";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { PlatformSettingsService } from "../admin/platform-settings.service";
import { BrandingService } from "./branding.service";

/**
 * Logos et favicons **envoyés par fichier**, à côté des adresses saisies.
 *
 * **Rangés en base.** Le panel a déjà un stockage S3, mais il est facultatif
 * et réservé aux sauvegardes ; un dossier sur disque ne survivrait pas à une
 * mise à jour de l'hébergement cPanel, qui remplace le dossier de
 * l'application, et n'y serait servi par aucun nginx. Une image de 512 Kio au
 * plus tient en base sans peine, part avec ses sauvegardes, et se sert de la
 * même façon sur toutes les installations.
 *
 * **Une adresse ne change jamais de contenu.** Chaque envoi crée une ligne,
 * donc un chemin neuf (`/brand/fichier/<id>`), qui prend la place de l'ancien
 * dans le champ `logoUrl` ou `faviconUrl`. Les images que plus aucun champ ne
 * désigne sont effacées (`prune`) : ni orphelines accumulées, ni image
 * effacée alors qu'un champ la sert encore.
 *
 * **Un propriétaire à la fois.** Envoi et nettoyage tiennent dans une
 * transaction sous un verrou consultatif par propriétaire : sans lui, le
 * nettoyage d'un envoi effaçait l'image d'un envoi simultané (le favicon
 * envoyé juste après le logo), rangée mais pas encore inscrite dans la marque.
 */

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Propriétaire d'une image : un revendeur, ou la plateforme (`null`). */
type Owner = string | null;

const FIELD: Record<BrandImageKind, "logoUrl" | "faviconUrl"> = {
  logo: "logoUrl",
  favicon: "faviconUrl",
};

export interface StoredBrandImage {
  contentType: string;
  sha256: string;
  bytes: Buffer;
}

@Injectable()
export class BrandImagesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PlatformSettingsService) private readonly platformSettings: PlatformSettingsService,
    @Inject(BrandingService) private readonly branding: BrandingService,
  ) {}

  /**
   * Range l'image d'un revendeur et la fait servir aussitôt par sa marque.
   *
   * Le champ est écrit ici, et non laissé au formulaire : un envoi réussi dont
   * l'adresse ne serait enregistrée qu'au clic suivant sur « Enregistrer »
   * laisserait une image rangée que rien n'affiche.
   */
  async uploadForReseller(userId: string, kind: BrandImageKind, body: unknown): Promise<string> {
    const image = checkedBrandImage(body);
    const path = await this.locked(userId, async (tx) => {
      const path = await store(tx, userId, kind, image);
      const field = kind === "logo" ? { logoUrl: path } : { faviconUrl: path };
      await tx
        .insert(resellerBrandings)
        .values({ userId, ...field })
        .onConflictDoUpdate({
          target: resellerBrandings.userId,
          set: { ...field, updatedAt: new Date().toISOString() },
        });
      await prune(tx, userId);
      return path;
    });
    this.branding.forgetAll();
    return path;
  }

  /** Même chose pour la marque de la plateforme, par ses réglages `brand.*`. */
  async uploadForPlatform(kind: BrandImageKind, body: unknown): Promise<string> {
    const image = checkedBrandImage(body);
    const path = await this.locked(null, async (tx) => {
      const path = await store(tx, null, kind, image);
      // Le réglage passe par le service, contrôles compris, dans la transaction.
      await this.platformSettings.save({ [PLATFORM_BRAND_SETTINGS[FIELD[kind]]]: path }, tx);
      await prune(tx, null);
      return path;
    });
    this.branding.forgetAll();
    return path;
  }

  /** L'image à servir, ou `null` : identifiant malformé ou inconnu. */
  async read(id: string): Promise<StoredBrandImage | null> {
    if (!isBrandImageId(id)) return null;
    const [row] = await this.db
      .select({
        contentType: brandImages.contentType,
        sha256: brandImages.sha256,
        bytes: brandImages.bytes,
      })
      .from(brandImages)
      .where(eq(brandImages.id, id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Efface les images d'un propriétaire que plus aucun de ses champs ne sert.
   *
   * Appelé après tout enregistrement de la marque : un champ vidé ou remplacé
   * par une adresse externe libère son image. Sous le même verrou que l'envoi.
   */
  async prune(owner: Owner): Promise<void> {
    await this.locked(owner, (tx) => prune(tx, owner));
  }

  /** `work` dans une transaction, seul à toucher aux images de ce propriétaire. */
  private locked<T>(owner: Owner, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`brand_images:${owner ?? "plateforme"}`}))`,
      );
      return work(tx);
    });
  }
}

/** Range des octets contrôlés (`checkedBrandImage`). Rend le chemin interne de l'image. */
async function store(
  tx: Transaction,
  owner: Owner,
  kind: BrandImageKind,
  image: CheckedBrandImage,
): Promise<string> {
  const [row] = await tx
    .insert(brandImages)
    .values({ resellerId: owner, kind, ...image })
    .returning({ id: brandImages.id });
  if (!row) throw new Error("L'image n'a pas été enregistrée.");
  return brandImagePath(row.id);
}

async function prune(tx: Transaction, owner: Owner): Promise<void> {
  const kept = (await referencedUrls(tx, owner)).flatMap((url) => {
    const id = brandImageIdOf(url);
    return id ? [id] : [];
  });

  const ofOwner =
    owner === null ? isNull(brandImages.resellerId) : eq(brandImages.resellerId, owner);
  await tx
    .delete(brandImages)
    .where(kept.length > 0 ? and(ofOwner, notInArray(brandImages.id, kept)) : ofOwner);
}

/**
 * Adresses de logo et de favicon enregistrées pour ce propriétaire, lues
 * **dans la transaction** : l'adresse que l'envoi vient d'écrire en fait partie.
 */
async function referencedUrls(tx: Transaction, owner: Owner): Promise<string[]> {
  if (owner === null) {
    const rows = await tx
      .select({ value: settings.value })
      .from(settings)
      .where(
        inArray(settings.key, [
          PLATFORM_BRAND_SETTINGS.logoUrl,
          PLATFORM_BRAND_SETTINGS.faviconUrl,
        ]),
      );
    return rows.flatMap((row) => (typeof row.value === "string" ? [row.value] : []));
  }
  const [row] = await tx
    .select({ logoUrl: resellerBrandings.logoUrl, faviconUrl: resellerBrandings.faviconUrl })
    .from(resellerBrandings)
    .where(eq(resellerBrandings.userId, owner))
    .limit(1);
  return row ? [row.logoUrl, row.faviconUrl] : [];
}

interface CheckedBrandImage {
  contentType: string;
  sha256: string;
  bytes: Buffer;
}

/**
 * Contrôle les octets reçus, **hors transaction** : un refus n'a rien à verrouiller.
 *
 * La taille est contrôlée ici **en plus** du plafond de l'analyseur du
 * corps (`main.ts`), qui est celui, plus large, des morceaux d'envoi de
 * fichiers : une image de marque n'a pas à peser un mégaoctet.
 */
function checkedBrandImage(body: unknown): CheckedBrandImage {
  const bytes = checkedImage(body);
  const contentType = sniffBrandImage(bytes);
  if (contentType === null) {
    throw new BadRequestException(
      "Image refusée : seuls les formats PNG, JPEG, WebP et ICO sont acceptés (pas de SVG).",
    );
  }
  return { contentType, sha256: createHash("sha256").update(bytes).digest("hex"), bytes };
}

/**
 * Le corps reçu, s'il est bien un envoi binaire de taille acceptable.
 *
 * Fastify ne rend un `Buffer` que pour `application/octet-stream` : tout
 * autre type veut dire qu'on n'a pas reçu un fichier.
 */
export function checkedImage(body: unknown): Buffer {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new BadRequestException("Aucune image reçue.");
  }
  if (body.length > BRAND_IMAGE_MAX_BYTES) {
    throw new PayloadTooLargeException(
      `Image trop lourde : ${Math.ceil(BRAND_IMAGE_MAX_BYTES / 1024)} Kio au plus.`,
    );
  }
  return body;
}
