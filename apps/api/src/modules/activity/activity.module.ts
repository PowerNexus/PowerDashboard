import { Module } from "@nestjs/common";
import { databaseProvider } from "../../common/database.provider";
import { ActivityService } from "./activity.service";
import { DenialLogService } from "./denial-log.service";

/**
 * Le journal d'audit.
 *
 * Module partagé, importé par le module client comme par le module remote :
 * une action peut venir du panel ou du daemon, et les deux doivent aboutir
 * dans le même journal. Deux implémentations donneraient deux histoires.
 */
@Module({
  // `DenialLogService` vit ici, et une seule fois : ses regroupements sont en
  // mémoire, et une instance par module compterait chacune de son côté.
  providers: [databaseProvider, ActivityService, DenialLogService],
  exports: [ActivityService, DenialLogService],
})
export class ActivityModule {}
