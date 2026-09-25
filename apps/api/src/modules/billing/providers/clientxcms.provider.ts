import type { BilledService } from "@gamedashboard/contracts";
import { readServiceState } from "@gamedashboard/contracts";
import { asArray, asId, asRecord, asText, BillingRefusal, getWithBearer } from "../billing-http";
import {
  type BillingClient,
  type BillingConnection,
  type BillingProvider,
  billedService,
  MAX_PAGES,
} from "../billing-provider";

/** Éléments demandés par page. ClientXCMS en rend 25 si l'on ne dit rien. */
const PAGE_SIZE = 100;

/**
 * ClientXCMS Next Gen, par son API d'application (`/api/application`).
 *
 * Jeton Sanctum en `Authorization: Bearer`, créé dans l'administration de
 * ClientXCMS avec les seules capacités `customers:index`, `customers:show` et
 * `services:index`. L'identifiant d'API ne sert pas.
 *
 * Relevé sur le code de ClientXCMS (`routes/api-application.php`,
 * `Api/Customers/CustomerController`, `Api/Provisioning/ServiceController`) :
 * les listes passent par `spatie/laravel-query-builder`, dont les filtres sont
 * des `LIKE %…%`. `filter[customer_id]=4` rend donc aussi les services des
 * clients 14, 42 et 400 : chaque ligne est revérifiée ici, à l'identique.
 */
export class ClientxcmsProvider implements BillingProvider {
  readonly kind = "clientxcms" as const;

  async clientById(connection: BillingConnection, id: string): Promise<BillingClient | null> {
    if (!/^\d+$/.test(id)) return null;
    try {
      const response = await getWithBearer(
        this.url(connection, `customers/${id}`),
        connection.apiKey,
      );
      return readClient(asRecord(response.data) ?? response);
    } catch (error) {
      if (error instanceof Error && /\b404\b/.test(error.message)) return null;
      throw error;
    }
  }

  async clientsByEmail(connection: BillingConnection, email: string): Promise<BillingClient[]> {
    const rows = await this.list(connection, "customers", { "filter[email]": email });
    return rows.flatMap((raw) => {
      const client = readClient(raw);
      return client ? [client] : [];
    });
  }

  async servicesOf(connection: BillingConnection, clientId: string): Promise<BilledService[]> {
    const rows = await this.list(connection, "services", {
      "filter[customer_id]": clientId,
      include: "pricing",
    });

    return rows.flatMap((raw): BilledService[] => {
      const service = asRecord(raw);
      const id = asId(service?.id);
      // Le filtre de ClientXCMS est partiel : seul l'identifiant exact compte.
      if (!service || !id || asId(service.customer_id) !== clientId) return [];
      // Un service masqué par l'hébergeur n'est pas montré au client chez
      // ClientXCMS ; le panel ne le montre pas non plus.
      if (asText(service.status) === "hidden") return [];

      const billing = asText(service.billing);
      const pricing = asRecord(service.pricing);
      return [
        billedService({
          id,
          name: asText(service.name),
          plan: null,
          state: readServiceState(service.status),
          dueDate: asText(service.expires_at),
          amount: billing && pricing ? asText(pricing[billing]) : null,
          currency: asText(service.currency),
        }),
      ];
    });
  }

  /** Une liste paginée à la manière de Laravel (`data`, `meta.last_page`). */
  private async list(
    connection: BillingConnection,
    path: string,
    params: Record<string, string>,
  ): Promise<unknown[]> {
    const rows: unknown[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = this.url(connection, path);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      url.searchParams.set("per_page", String(PAGE_SIZE));
      url.searchParams.set("page", String(page));

      const response = await getWithBearer(url, connection.apiKey);
      const data = asArray(response.data);
      rows.push(...data);

      const lastPage = Number(asRecord(response.meta)?.last_page ?? response.last_page);
      if (data.length === 0 || !Number.isFinite(lastPage) || page >= lastPage) break;
    }
    return rows;
  }

  /**
   * L'adresse d'une route, quelle que soit la forme saisie.
   *
   * L'exploitant peut coller l'adresse du site (`https://cx.exemple.fr`) ou
   * celle de l'API (`…/api/application`) : les deux mènent au même endroit.
   */
  private url(connection: BillingConnection, path: string): URL {
    const base = connection.apiUrl
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/api\/application$/, "");
    try {
      return new URL(`${base}/api/application/${path}`);
    } catch {
      throw new BillingRefusal("L'adresse de l'API de facturation est illisible.");
    }
  }
}

function readClient(raw: unknown): BillingClient | null {
  const client = asRecord(raw);
  const id = asId(client?.id);
  const email = asText(client?.email);
  return id && email ? { id, email } : null;
}
