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
import { brandImages, type Database, resellerBrandings } from "@gamedashboard/db";
import { BadRequestException, Inject, Injectable, PayloadTooLargeException } from "@nestjs/common";
import { and, eq, isNull, notInArray } from "drizzle-orm";
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
 */

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
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
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
    const path = await this.store(userId, kind, body);
    const field = kind === "logo" ? { logoUrl: path } : { faviconUrl: path };
    await this.db
      .insert(resellerBrandings)
      .values({ userId, ...field })
      .onConflictDoUpdate({
        target: resellerBrandings.userId,
        set: { ...field, updatedAt: new Date().toISOString() },
      });
    await this.prune(userId);
    this.branding.forgetAll();
    return path;
  }

  /** Même chose pour la marque de la plateforme, par ses réglages `brand.*`. */
  async uploadForPlatform(kind: BrandImageKind, body: unknown): Promise<string> {
    const path = await this.store(null, kind, body);
    await this.settings.save({ [PLATFORM_BRAND_SETTINGS[FIELD[kind]]]: path });
    await this.prune(null);
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
   * Appelé après un envoi, et après tout enregistrement de la marque : un
   * champ vidé ou remplacé par une adresse externe libère son image.
   */
  async prune(owner: Owner): Promise<void> {
    const kept = (await this.referencedUrls(owner)).flatMap((url) => {
      const id = brandImageIdOf(url);
      return id ? [id] : [];
    });

    const ofOwner =
      owner === null ? isNull(brandImages.resellerId) : eq(brandImages.resellerId, owner);
    await this.db
      .delete(brandImages)
      .where(kept.length > 0 ? and(ofOwner, notInArray(brandImages.id, kept)) : ofOwner);
  }

  /**
   * Contrôle et range les octets reçus. Rend le chemin interne de l'image.
   *
   * La taille est contrôlée ici **en plus** du plafond de l'analyseur du
   * corps (`main.ts`), qui est celui, plus large, des morceaux d'envoi de
   * fichiers : une image de marque n'a pas à peser un mégaoctet.
   */
  private async store(owner: Owner, kind: BrandImageKind, body: unknown): Promise<string> {
    const bytes = checkedImage(body);
    const contentType = sniffBrandImage(bytes);
    if (contentType === null) {
      throw new BadRequestException(
        "Image refusée : seuls les formats PNG, JPEG, WebP et ICO sont acceptés (pas de SVG).",
      );
    }

    const [row] = await this.db
      .insert(brandImages)
      .values({
        resellerId: owner,
        kind,
        contentType,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes,
      })
      .returning({ id: brandImages.id });
    if (!row) throw new Error("L'image n'a pas été enregistrée.");
    return brandImagePath(row.id);
  }

  /** Adresses de logo et de favicon actuellement enregistrées pour ce propriétaire. */
  private async referencedUrls(owner: Owner): Promise<string[]> {
    if (owner === null) {
      return Promise.all([
        this.settings.text(PLATFORM_BRAND_SETTINGS.logoUrl),
        this.settings.text(PLATFORM_BRAND_SETTINGS.faviconUrl),
      ]);
    }
    const [row] = await this.db
      .select({ logoUrl: resellerBrandings.logoUrl, faviconUrl: resellerBrandings.faviconUrl })
      .from(resellerBrandings)
      .where(eq(resellerBrandings.userId, owner))
      .limit(1);
    return row ? [row.logoUrl, row.faviconUrl] : [];
  }
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
