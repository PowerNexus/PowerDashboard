import type { BilledService } from "@gamedashboard/contracts";
import { readServiceState } from "@gamedashboard/contracts";
import { asArray, asId, asRecord, asText, BillingRefusal, postForm } from "../billing-http";
import {
  type BillingClient,
  type BillingConnection,
  type BillingProvider,
  billedService,
  MAX_PAGES,
} from "../billing-provider";

/** Produits demandés par page. WHMCS en rend 25 si l'on ne dit rien. */
const PAGE_SIZE = 100;

/**
 * WHMCS, par son API (`/includes/api.php`), identifiants d'API dans le corps.
 *
 * Actions et champs relevés sur developers.whmcs.com : `GetClientsDetails`
 * (par `clientid` ou `email`, correspondance exacte), `GetClientsProducts`
 * (`products.product[]` : `name`, `groupname`, `domain`, `status`,
 * `nextduedate`, `recurringamount`), paginé par `limitstart`/`limitnum`.
 *
 * L'exploitant doit autoriser l'adresse IP du panel dans les restrictions
 * d'API de WHMCS ; sans cela, chaque appel est refusé.
 */
export class WhmcsProvider implements BillingProvider {
  readonly kind = "whmcs" as const;

  async clientById(connection: BillingConnection, id: string): Promise<BillingClient | null> {
    return this.details(connection, { clientid: id });
  }

  async clientsByEmail(connection: BillingConnection, email: string): Promise<BillingClient[]> {
    const client = await this.details(connection, { email });
    return client ? [client] : [];
  }

  async servicesOf(connection: BillingConnection, clientId: string): Promise<BilledService[]> {
    // La devise est celle du client, pas celle du produit : WHMCS ne la répète
    // pas sur chaque ligne.
    const details = await this.call(connection, "GetClientsDetails", { clientid: clientId });
    const currency =
      asText(details.currency_code) ?? asText(asRecord(details.client)?.currency_code);

    const services: BilledService[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await this.call(connection, "GetClientsProducts", {
        clientid: clientId,
        limitstart: String(page * PAGE_SIZE),
        limitnum: String(PAGE_SIZE),
      });
      const products = asArray(asRecord(response.products)?.product);

      for (const raw of products) {
        const product = asRecord(raw);
        const id = asId(product?.id);
        // Filtre de sûreté : un produit d'un autre client ne s'affiche jamais,
        // quoi que rende le facturier.
        if (!product || !id || asId(product.clientid) !== clientId) continue;
        services.push(
          billedService({
            id,
            name: asText(product.domain) ?? asText(product.name),
            plan: asText(product.name),
            state: readServiceState(product.status),
            dueDate: asText(product.nextduedate),
            amount: asText(product.recurringamount),
            currency,
          }),
        );
      }

      const total = Number(response.totalresults);
      const seen = page * PAGE_SIZE + products.length;
      if (products.length === 0 || !Number.isFinite(total) || seen >= total) break;
    }
    return services;
  }

  /** La fiche du client, ou `null` quand WHMCS ne le connaît pas. */
  private async details(
    connection: BillingConnection,
    params: Record<string, string>,
  ): Promise<BillingClient | null> {
    try {
      const response = await this.call(connection, "GetClientsDetails", params);
      const client = asRecord(response.client) ?? response;
      const id = asId(client.id ?? client.userid ?? client.client_id);
      const email = asText(client.email);
      return id && email ? { id, email } : null;
    } catch (error) {
      if (error instanceof BillingRefusal && /not found/i.test(error.message)) return null;
      throw error;
    }
  }

  /**
   * Un appel à l'API.
   *
   * WHMCS répond **200 avec `result: "error"`** pour une clé refusée comme
   * pour un client introuvable ; seul le message les distingue.
   */
  private async call(
    connection: BillingConnection,
    action: string,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const payload = await postForm(connection.apiUrl, {
      identifier: connection.apiId,
      secret: connection.apiKey,
      action,
      responsetype: "json",
      ...params,
    });
    if (payload.result !== "success") {
      throw new BillingRefusal(asText(payload.message) ?? "WHMCS a refusé l'appel.");
    }
    return payload;
  }
}
