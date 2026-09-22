import { Module } from "@nestjs/common";
import { databaseProvider } from "../../common/database.provider";
import { PlatformSettingsService } from "../admin/platform-settings.service";
import { S3Service } from "./s3.service";

/**
 * Stockage distant des archives.
 *
 * Module à part du module d'administration, bien qu'il lise ses réglages : il
 * est employé par le module remote — que le daemon appelle — et importer
 * l'administration depuis là ferait entrer ses gardes et ses contrôleurs dans
 * un chemin qui n'a rien à voir avec une session d'administrateur.
 *
 * Le service de réglages est donc fourni ici, comme le fait déjà le module
 * d'authentification, et pour la même raison.
 */
@Module({
  providers: [databaseProvider, PlatformSettingsService, S3Service],
  exports: [S3Service],
})
export class StorageModule {}
