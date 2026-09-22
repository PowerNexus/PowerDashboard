import { Module } from "@nestjs/common";
import { databaseProvider } from "../../common/database.provider";
import { ActivityService } from "./activity.service";

/**
 * Le journal d'audit.
 *
 * Module partagé, importé par le module client comme par le module remote :
 * une action peut venir du panel ou du daemon, et les deux doivent aboutir
 * dans le même journal. Deux implémentations donneraient deux histoires.
 */
@Module({
  providers: [databaseProvider, ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
