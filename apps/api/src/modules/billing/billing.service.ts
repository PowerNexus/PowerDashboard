import {
  BILLING_PROVIDER_LABELS,
  BILLING_SILENT,
  type BillingProviderKind,
  type BillingSummary,
  readableBillingProvider,
} from "@gamedashboard/contracts";
import { type Database, settings, users } from "@gamedashboard/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { decryptRowSecret } from "../../common/row-secrets";
import { BillingRefusal } from "./billing-http";
import type { BillingConnection, BillingProvider } from "./billing-provider";

/** Jeton d'injection du registre des facturiers, substitué par les tests. */
export const BILLING_PROVIDERS = Symbol("BILLING_PROVIDERS");

export type BillingProviders = Readonly<Record<BillingProviderKind, BillingProvider>>;

/** Issue de l'essai de connexion lancé depuis l'administration. */
export interface BillingProbe {
  ok: boolean;
  provider: BillingProviderKind | null;
  /** Vrai si l'adresse de l'administrateur qui essaie est connue du facturier. */
  knowsCaller: boolean;
  error: string | null;
}

/**
 * Services et échéances d'un client, lus chez le facturier relié.
 *
 * **Lecture seule.** Le facturier facture, le panel exécute : cette direction
 * est la règle du projet, et l'inverser ferait deux systèmes responsables du
 * même chiffre. Rien ici n'écrit, ne commande, ni n'annule — le panel affiche,
 * et renvoie vers l'espace client pour agir.
 *
 * Aucune donnée n'est recopiée en base : une échéance mémorisée devient fausse
 * à la première facture payée ailleurs.
 *
 * Le facturier se choisit par `billing.provider`. Cette façade garde pour elle
 * ce qui ne doit pas dépendre de ce choix : le silence quand rien n'est réglé,
 * « injoignable » distinct de « aucun service », et la vérification de
 * l'adresse, qui décide de qui voit les échéances de qui.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BILLING_PROVIDERS) private readonly providers: BillingProviders,
  ) {}

  /**
   * Les services d'un client.
   *
   * Ne lève jamais : la page d'accueil du panel doit s'afficher même si la
   * facturation ne répond pas.
   */
  async summaryFor(userId: string): Promise<BillingSummary> {
    const setup = await this.configuration();
    if (!setup) return BILLING_SILENT;
    const { provider, connection, clientUrl } = setup;
    const empty: BillingSummary = {
      configured: true,
      provider: provider.kind,
      unreachable: false,
      services: [],
      clientUrl,
    };

    /*
     * L'adresse et l'identifiant externe sont relus ici, et non portés par la
     * session : celle-ci est résolue à chaque requête du panel, et un seul
     * écran s'en sert.
     */
    const [user] = await this.db
      .select({ email: users.email, externalId: users.externalId })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) return empty;

    try {
      const clientId = await this.findClientId(provider, connection, user);
      // Pas de compte chez le facturier : ce n'est pas une panne. Un client
      // créé à la main dans le panel n'a rien à facturer.
      if (clientId === null) return empty;
      return { ...empty, services: await provider.servicesOf(connection, clientId) };
    } catch (error) {
      this.logger.warn(
        `${BILLING_PROVIDER_LABELS[provider.kind]} injoignable : ${describe(error)}.`,
      );
      return { ...empty, unreachable: true };
    }
  }

  /**
   * Essai de connexion, pour l'administration.
   *
   * Cherche l'adresse de l'administrateur qui le demande : c'est un appel réel,
   * avec les vrais réglages, et il ne montre rien d'un client. Rend la phrase
   * du facturier en cas de refus — « IP non autorisée », « clé invalide » —
   * seule chose exploitable quand la liaison ne marche pas.
   */
  async probe(callerEmail: string): Promise<BillingProbe> {
    const setup = await this.configuration();
    if (!setup) {
      return {
        ok: false,
        provider: null,
        knowsCaller: false,
        error:
          "Choisissez un système de facturation lisible et renseignez l'adresse et la clé d'API, puis enregistrez.",
      };
    }
    const { provider, connection } = setup;
    try {
      const clientId = await this.findClientId(provider, connection, {
        email: callerEmail,
        externalId: null,
      });
      return { ok: true, provider: provider.kind, knowsCaller: clientId !== null, error: null };
    } catch (error) {
      return { ok: false, provider: provider.kind, knowsCaller: false, error: describe(error) };
    }
  }

  /**
   * Retrouve le client chez le facturier, et **vérifie que c'est bien lui**.
   *
   * Par `externalId` d'abord — le rattachement posé par le plugin à la
   * commande —, mais seulement si la fiche porte la même adresse. Un
   * `externalId` peut venir d'un autre facturier : après un passage de
   * HostBill à WHMCS, le client n° 42 de l'un n'est pas le n° 42 de l'autre,
   * et le lui afficher montrerait les échéances d'un inconnu.
   *
   * Par adresse ensuite, en ne retenant que l'adresse **exacte** : plusieurs
   * facturiers filtrent en recherche partielle, et « paul@ex.fr » peut rendre
   * « paul@ex.fr.co ». C'est l'erreur la moins acceptable de tout cet écran.
   */
  private async findClientId(
    provider: BillingProvider,
    connection: BillingConnection,
    user: { email: string; externalId: string | null },
  ): Promise<string | null> {
    const email = normalise(user.email);

    if (user.externalId) {
      const linked = await provider.clientById(connection, user.externalId);
      if (linked && normalise(linked.email) === email) return linked.id;
    }

    const candidates = await provider.clientsByEmail(connection, user.email.trim());
    return candidates.find((client) => normalise(client.email) === email)?.id ?? null;
  }

  /**
   * Le facturier choisi et ses réglages, ou `null`.
   *
   * `null` dès qu'il manque quelque chose, plutôt qu'un objet à trous : une
   * configuration partielle produirait un appel vers `undefined` à chaque
   * page d'accueil ouverte. « Aucun » et « sur mesure » rendent `null` aussi :
   * ils n'ont pas d'API de lecture, et interroger une boutique WHMCS comme si
   * c'était HostBill faisait dire « injoignable » à tous les clients.
   */
  private async configuration(): Promise<{
    provider: BillingProvider;
    connection: BillingConnection;
    clientUrl: string | null;
  } | null> {
    const rows = await this.db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(
        inArray(settings.key, [
          "billing.provider",
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

    const kind = readableBillingProvider(text("billing.provider"));
    if (!kind) return null;
    const provider = this.providers[kind];

    const apiUrl = text("billing.apiUrl");
    const apiId = text("billing.apiId");
    const encrypted = text("billing.apiKey");
    // ClientXCMS n'emploie qu'un jeton : l'identifiant n'y est pas exigé.
    if (!apiUrl || !encrypted || (!apiId && kind !== "clientxcms")) return null;

    let apiKey: string;
    try {
      apiKey = decryptRowSecret("settings.value", "billing.apiKey", encrypted);
    } catch {
      // Clé maître changée, ligne abîmée : se taire vaut mieux qu'appeler le
      // facturier avec un secret illisible, ce qui compterait comme un échec
      // d'authentification de plus à chaque page ouverte.
      this.logger.error("Clé d'API de facturation illisible : la facturation reste masquée.");
      return null;
    }

    return {
      provider,
      connection: { apiUrl, apiId, apiKey },
      clientUrl: text("billing.clientUrl") || null,
    };
  }
}

function normalise(email: string): string {
  return email.trim().toLowerCase();
}

function describe(error: unknown): string {
  if (error instanceof BillingRefusal) return error.message;
  return error instanceof Error ? error.message : "cause inconnue";
}
