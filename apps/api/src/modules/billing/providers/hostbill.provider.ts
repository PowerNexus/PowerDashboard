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

/**
 * HostBill, par son API d'administration (`/admin/api.php`).
 *
 * Appels et champs relevés sur la documentation (api2.hostbillapp.com) :
 * `getClientDetails` (`client.id`, `client.email`), `getClients` filtré par
 * `filter[email]`, `getClientAccounts` (`accounts[]` : `domain`, `name`,
 * `status`, `next_due`, `total`, `billingcycle`), paginé par `page`.
 *
 * L'ancienne lecture appelait `clients/getClients` avec `email=` et lisait
 * `nextduedate` : le nom d'appel, le filtre et le champ d'échéance ne sont pas
 * ceux de HostBill, et aucune échéance n'aurait été vue.
 */
export class HostbillProvider implements BillingProvider {
  readonly kind = "hostbill" as const;

  async clientById(connection: BillingConnection, id: string): Promise<BillingClient | null> {
    try {
      const response = await this.call(connection, "getClientDetails", { id });
      return readClient(response.client);
    } catch (error) {
      // HostBill répond `success: false` pour un client inconnu comme pour une
      // clé refusée. Un identifiant qui n'existe plus n'est pas une panne : la
      // façade retombe alors sur la recherche par adresse, dont l'appel dira,
      // lui, si la clé est refusée.
      if (error instanceof BillingRefusal) return null;
      throw error;
    }
  }

  async clientsByEmail(connection: BillingConnection, email: string): Promise<BillingClient[]> {
    const response = await this.call(connection, "getClients", { "filter[email]": email });
    return asArray(response.clients).flatMap((raw) => {
      const client = readClient(raw);
      return client ? [client] : [];
    });
  }

  async servicesOf(connection: BillingConnection, clientId: string): Promise<BilledService[]> {
    const services = new Map<string, BilledService>();

    // HostBill ne dit pas combien de pages il reste : on lit jusqu'à la page
    // qui n'apporte rien de nouveau. La documentation ne dit pas si la
    // première page porte le numéro 0 ou 1 : si 0 et 1 rendent la même, la
    // page 1 n'apporte rien sans que la liste soit finie, et on lit la 2.
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await this.call(connection, "getClientAccounts", {
        id: clientId,
        page: String(page),
      });
      const accounts = asArray(response.accounts);
      let added = 0;
      for (const raw of accounts) {
        const account = asRecord(raw);
        const id = asId(account?.id);
        if (!account || !id || services.has(id)) continue;
        services.set(
          id,
          billedService({
            id,
            // `domain` porte le nom donné au service ; le produit sert de repli.
            name: asText(account.domain) ?? asText(account.name),
            plan: asText(account.name),
            state: readServiceState(account.status),
            dueDate: asText(account.next_due),
            amount: asText(account.total),
            // HostBill ne donne qu'un `currency_id` : le montant s'affiche
            // sans devise plutôt qu'avec une devise devinée.
            currency: null,
          }),
        );
        added++;
      }
      const sameAsFirst = page === 1 && accounts.length > 0;
      if (added === 0 && !sameAsFirst) break;
    }

    return [...services.values()];
  }

  /**
   * Un appel à l'API d'administration.
   *
   * HostBill répond **200 avec `success: false`** quand la clé est refusée.
   * Sans ce test, une clé invalide produirait une liste vide, et le panel
   * dirait « aucun service » à des clients qui en ont.
   */
  private async call(
    connection: BillingConnection,
    call: string,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const payload = await postForm(connection.apiUrl, {
      api_id: connection.apiId,
      api_key: connection.apiKey,
      call,
      ...params,
    });
    if (payload.success === false) {
      const reason = asText(payload.error) ?? asText(asArray(payload.error)[0] ?? null);
      throw new BillingRefusal(reason ?? "HostBill a refusé l'appel.");
    }
    return payload;
  }
}

function readClient(raw: unknown): BillingClient | null {
  const client = asRecord(raw);
  const id = asId(client?.id);
  const email = asText(client?.email);
  return id && email ? { id, email } : null;
}
