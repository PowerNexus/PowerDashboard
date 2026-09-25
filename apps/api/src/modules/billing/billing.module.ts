import { Module } from "@nestjs/common";
import { databaseProvider } from "../../common/database.provider";
import { BILLING_PROVIDERS, type BillingProviders, BillingService } from "./billing.service";
import { ClientxcmsProvider } from "./providers/clientxcms.provider";
import { HostbillProvider } from "./providers/hostbill.provider";
import { WhmcsProvider } from "./providers/whmcs.provider";

/**
 * La lecture de la facturation reliée.
 *
 * Module à part, et non un service du module client : l'accueil du client et
 * la veille des échéances (planificateur) la lisent tous deux, et l'essai de
 * connexion de l'administration aussi.
 */
@Module({
  providers: [
    databaseProvider,
    {
      provide: BILLING_PROVIDERS,
      useFactory: (): BillingProviders => ({
        hostbill: new HostbillProvider(),
        whmcs: new WhmcsProvider(),
        clientxcms: new ClientxcmsProvider(),
      }),
    },
    BillingService,
  ],
  exports: [BillingService],
})
export class BillingModule {}
