import { Module } from "@nestjs/common";
import { databaseProvider } from "../../common/database.provider";
import { HealthController } from "./health.controller";

/**
 * Le point de santé, seul dans son module.
 *
 * Il n'importe rien d'autre que la base : un module de santé qui dépendrait de
 * la moitié de l'application tomberait en même temps qu'elle, et ne servirait
 * plus à rien au moment précis où on l'interroge.
 */
@Module({
  providers: [databaseProvider],
  controllers: [HealthController],
})
export class HealthModule {}
