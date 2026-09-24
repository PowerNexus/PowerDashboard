import { Module } from "@nestjs/common";
import { databaseProvider } from "../../common/database.provider";
import { ActivityModule } from "../activity/activity.module";
import { AdminModule } from "../admin/admin.module";
import { PlatformSettingsService } from "../admin/platform-settings.service";
import { AuthModule } from "../auth/auth.module";
import { UpdateService } from "./update.service";
import { UpdatesAdminController, UpdatesSignalController } from "./updates.controller";

/**
 * Mise à jour autonome depuis les releases GitHub (hébergement cPanel).
 *
 * `AdminModule` n'est importé que pour ses gardes, comme le fait le module
 * de statut ; et comme lui, `PlatformSettingsService`, que lit le garde de
 * la seconde preuve du personnel, est fourni ici plutôt qu'importé.
 */
@Module({
  imports: [AuthModule, AdminModule, ActivityModule],
  providers: [databaseProvider, PlatformSettingsService, UpdateService],
  controllers: [UpdatesAdminController, UpdatesSignalController],
})
export class UpdatesModule {}
