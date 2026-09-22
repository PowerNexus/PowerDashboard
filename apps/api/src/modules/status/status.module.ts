import { Module } from "@nestjs/common";
import { databaseProvider } from "../../common/database.provider";
import { ActivityModule } from "../activity/activity.module";
import { AdminModule } from "../admin/admin.module";
import { PlatformSettingsService } from "../admin/platform-settings.service";
import { AuthModule } from "../auth/auth.module";
import { IncidentsController } from "./incidents.controller";
import { IncidentsService } from "./incidents.service";
import { InstatusService } from "./instatus.service";
import { OpenApiController } from "./openapi.controller";
import { StatusController } from "./status.controller";
import { StatusService } from "./status.service";

/**
 * Page de statut : la lecture publique et la rédaction réservée.
 *
 * Les deux contrôleurs vivent ensemble parce qu'ils décrivent la même chose,
 * mais ne partagent aucune garde : l'un s'ouvre sans compte, l'autre exige un
 * administrateur. C'est la raison pour laquelle ils sont deux classes et non
 * deux méthodes — une garde posée au niveau du contrôleur ne peut pas déborder
 * sur l'autre.
 *
 * `AdminModule` n'est importé que pour ses gardes ; le module de statut, lui,
 * n'est importé par personne, ce qui exclut tout cycle.
 */
@Module({
  imports: [AuthModule, AdminModule, ActivityModule],
  providers: [
    databaseProvider,
    StatusService,
    IncidentsService,
    InstatusService,
    // Le garde qui exige une seconde preuve du personnel lit ce service : il est
    // fourni ici plutôt qu'importé, comme le fait déjà le module
    // d'authentification, parce que le module d'administration importe déjà
    // celui-ci et qu'un import en retour formerait un cycle.
    PlatformSettingsService,
  ],
  // La spécification OpenAPI est servie ici plutôt que dans un module à elle :
  // comme la page de statut, elle est publique, sans garde et sans dépendance.
  controllers: [StatusController, IncidentsController, OpenApiController],
})
export class StatusModule {}
