import { Module } from "@nestjs/common";
import { databaseProvider } from "../../common/database.provider";
import { WebhookDispatcherService } from "./webhook-dispatcher.service";
import { WebhookEmitterService } from "./webhook-emitter.service";
import { WebhookRegistryService } from "./webhook-registry.service";

/**
 * Rappels sortants vers les systèmes tiers.
 *
 * Ce module n'importe **rien** d'autre que la base, et c'est structurel : il
 * est importé par ceux qui font changer l'état — provisionnement, actions
 * d'administration, retours du daemon. S'il importait l'un d'eux en retour, le
 * graphe se refermerait, et Nest refuserait de démarrer.
 *
 * Le contrôleur d'administration ne vit donc pas ici mais dans le module
 * applicatif, qui dispose déjà des gardes et n'est importé par personne.
 */
@Module({
  providers: [
    databaseProvider,
    WebhookEmitterService,
    WebhookDispatcherService,
    WebhookRegistryService,
  ],
  exports: [WebhookEmitterService, WebhookRegistryService],
})
export class WebhooksModule {}
