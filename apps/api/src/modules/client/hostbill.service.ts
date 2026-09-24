import {
  daysUntil,
  HOSTBILL_SILENT,
  type HostbillService as HostbillServiceEntry,
  type HostbillSummary,
  readServiceState,
} from "@gamedashboard/contracts";
import { type Database, settings, users } from "@gamedashboard/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { decryptRowSecret } from "../../common/row-secrets";

/**
 * Services et échéances d'un client, lus chez HostBill.
 *
 * **Lecture seule.** HostBill facture, le panel exécute : cette direction est
 * la règle du projet, et l'inverser ferait deux systèmes responsables du même
 * chiffre. Rien ici n'écrit, ne commande, ni n'annule — le panel affiche, et
 * renvoie vers l'espace client pour agir.
 *
 * Aucune donnée n'est recopiée en base : une échéance mémorisée devient fausse
 * à la première facture payée ailleurs, et un panel qui réclame un paiement
 * déjà fait coûte plus cher en support qu'il ne rapporte en affichage.
 */

const FETCH_TIMEOUT_MS = 6_000;

/** Ce que HostBill renvoie, réduit à ce dont on se sert. */
interface HostbillRawService {
  id?: unknown;
  name?: unknown;
  domain?: unknown;
  product_name?: unknown;
  status?: unknown;
  nextduedate?: unknown;
  total?: unknown;
  currency?: unknown;
  [key: string]: unknown;
}

@Injectable()
export class HostbillService {
  private readonly logger = new Logger(HostbillService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Les services d'un client.
   *
   * Ne lève jamais : la page d'accueil du panel doit s'afficher même si la
   * facturation ne répond pas. L'échec se dit `unreachable`, distinct d'une
   * liste vide — « nous n'avons pas pu demander » n'est pas « vous n'avez rien ».
   */
  async summaryFor(userId: string): Promise<HostbillSummary> {
    const config = await this.configuration();
    if (!config) return HOSTBILL_SILENT;

    /*
     * L'adresse et l'identifiant externe sont relus ici, et non portés par la
     * session.
     *
     * La session est résolue à **chaque requête** du panel ; y ajouter des
     * champs dont un seul écran se sert alourdirait tout le reste. Une lecture
     * de plus sur une page qui va de toute façon interroger un service distant
     * ne se voit pas.
     */
    const [user] = await this.db
      .select({ email: users.email, externalId: users.externalId })
      .from(users)
      .where(eq(users.id, userId));

    if (!user)
      return { configured: true, unreachable: false, services: [], clientUrl: config.clientUrl };

    try {
      const clientId = await this.findClientId(config, user);
      if (clientId === null) {
        // Pas de compte HostBill pour cette adresse : ce n'est pas une panne.
        // Un client créé à la main dans le panel n'a rien à facturer.
        return { configured: true, unreachable: false, services: [], clientUrl: config.clientUrl };
      }

      const services = await this.servicesOf(config, clientId);
      return { configured: true, unreachable: false, services, clientUrl: config.clientUrl };
    } catch (error) {
      this.logger.warn(
        `HostBill injoignable : ${error instanceof Error ? error.message : "cause inconnue"}.`,
      );
      return { configured: true, unreachable: true, services: [], clientUrl: config.clientUrl };
    }
  }

  /**
   * Retrouve le client chez HostBill.
   *
   * Par `externalId` d'abord — c'est le rattachement explicite, posé par le SSO
   * ou par l'API applicative au moment de la création du compte. Par adresse
   * e-mail ensuite, parce qu'un panel adopté après coup a des comptes qui n'ont
   * jamais reçu cet identifiant.
   *
   * Rend `null` plutôt que de lever : « ce client n'existe pas chez le
   * facturier » est un état normal, pas une erreur.
   */
  private async findClientId(
    config: HostbillConfiguration,
    user: { email: string; externalId: string | null },
  ): Promise<string | null> {
    if (user.externalId && /^\d+$/.test(user.externalId)) return user.externalId;

    const response = await this.call(config, "clients/getClients", { email: user.email });
    const clients = asArray(response.clients);

    const match = clients
      .map((client) => asRecord(client))
      .find(
        (client) =>
          typeof client?.email === "string" &&
          client.email.trim().toLowerCase() === user.email.trim().toLowerCase(),
      );

    /*
     * La correspondance est revérifiée **ici**, sur l'adresse exacte.
     *
     * `getClients` filtre en recherche partielle : demander « paul@ex.fr » peut
     * rendre « paul@ex.fr.co ». Se fier au premier résultat afficherait à
     * quelqu'un les échéances d'un autre — l'erreur la moins acceptable de tout
     * cet écran.
     */
    const id = match?.id;
    return typeof id === "string" || typeof id === "number" ? String(id) : null;
  }

  private async servicesOf(
    config: HostbillConfiguration,
    clientId: string,
  ): Promise<HostbillServiceEntry[]> {
    const response = await this.call(config, "clients/getClientAccounts", { id: clientId });
    const raw = asArray(response.accounts ?? response.services);

    return raw.flatMap((item): HostbillServiceEntry[] => {
      const service = asRecord(item) as HostbillRawService | null;
      if (!service) return [];

      const id = service.id;
      if (typeof id !== "string" && typeof id !== "number") return [];

      const dueDate = typeof service.nextduedate === "string" ? service.nextduedate.trim() : null;

      return [
        {
          id: String(id),
          // `domain` porte le nom donné au service dans HostBill ; le nom du
          // produit sert de repli, pour ne pas afficher une ligne anonyme.
          name:
            asText(service.domain) ??
            asText(service.name) ??
            asText(service.product_name) ??
            `#${id}`,
          plan: asText(service.product_name),
          state: readServiceState(service.status),
          dueDate: dueDate || null,
          daysLeft: dueDate ? daysUntil(dueDate) : null,
          amount: asText(service.total),
          currency: asText(service.currency),
        },
      ];
    });
  }

  /**
   * Un appel à l'API admin de HostBill.
   *
   * Les identifiants voyagent dans le **corps** et non dans l'adresse : une
   * clé d'API en paramètre d'URL finirait dans les journaux du serveur, dans
   * ceux du proxy, et dans l'historique de tout ce qui se trouve entre les
   * deux.
   */
  private async call(
    config: HostbillConfiguration,
    call: string,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    // La clé part dans le corps : en clair sur le réseau si l'adresse n'est
    // pas en https. Une erreur de saisie ne doit pas la publier.
    if (!config.apiUrl.trim().toLowerCase().startsWith("https://")) {
      throw new Error("L'adresse de l'API HostBill doit être en https.");
    }

    const body = new URLSearchParams({
      api_id: config.apiId,
      api_key: config.apiKey,
      call,
      ...params,
    });

    const response = await fetch(config.apiUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`HostBill a répondu ${response.status}.`);

    const payload = asRecord(await response.json());
    if (!payload) throw new Error("Réponse HostBill illisible.");

    /*
     * HostBill répond **200 avec `success: false`** quand la clé est refusée.
     *
     * Sans ce test, une clé invalide produirait une liste vide et le panel
     * afficherait « aucun service » à des clients qui en ont — une panne
     * silencieuse, et du support pour comprendre pourquoi.
     */
    if (payload.success === false) {
      const reason =
        asText(payload.error) ?? asText((asArray(payload.error)[0] as unknown) ?? null);
      throw new Error(reason ?? "HostBill a refusé l'appel.");
    }

    return payload;
  }

  /**
   * Les trois réglages indispensables, ou `null`.
   *
   * `null` dès qu'il en manque un, plutôt qu'un objet à trous : une
   * configuration partielle produirait un appel vers `undefined` et une trace
   * d'erreur à chaque page d'accueil ouverte.
   */
  private async configuration(): Promise<HostbillConfiguration | null> {
    const rows = await this.db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(
        inArray(settings.key, [
          "billing.apiUrl",
          "billing.apiId",
          "billing.apiKey",
          "billing.clientUrl",
        ]),
      );

    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const text = (key: string): string => {
      const raw = stored.get(key);
      return typeof raw === "string" ? raw.trim() : "";
    };

    const apiUrl = text("billing.apiUrl");
    const apiId = text("billing.apiId");
    const encrypted = text("billing.apiKey");
    if (!apiUrl || !apiId || !encrypted) return null;

    let apiKey: string;
    try {
      apiKey = decryptRowSecret("settings.value", "billing.apiKey", encrypted);
    } catch {
      // Clé maître changée, ligne abîmée : se taire vaut mieux qu'appeler
      // HostBill avec un secret illisible, ce qui compterait comme un échec
      // d'authentification de plus à chaque page ouverte.
      this.logger.error("Clé d'API HostBill illisible : la facturation reste masquée.");
      return null;
    }

    return { apiUrl, apiId, apiKey, clientUrl: text("billing.clientUrl") || null };
  }
}

interface HostbillConfiguration {
  apiUrl: string;
  apiId: string;
  apiKey: string;
  clientUrl: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
