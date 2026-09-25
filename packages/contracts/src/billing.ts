/**
 * Lecture de la facturation reliée : HostBill, WHMCS ou ClientXCMS.
 *
 * Le panel **lit** le facturier, il n'y écrit rien. La facturation reste chez le
 * tiers, qui pilote le panel par l'API applicative ; l'inverse — un panel qui
 * créerait des factures — ferait deux systèmes responsables du même chiffre,
 * et deux réponses différentes le jour où ils divergent.
 *
 * Ce module traduit et calcule. Il ne connaît ni le réseau ni les réglages :
 * le compte à rebours d'une échéance doit pouvoir être éprouvé sans eux, parce
 * que c'est exactement le genre de calcul qu'on rate d'un jour.
 */

/**
 * Les facturiers que le panel sait lire.
 *
 * Sous-ensemble des valeurs de `billing.provider` : « aucun » et « sur mesure »
 * n'ont pas d'API de lecture connue, et le panel n'affiche alors aucun service.
 */
export const BILLING_PROVIDERS = ["hostbill", "whmcs", "clientxcms"] as const;

export type BillingProviderKind = (typeof BILLING_PROVIDERS)[number];

/** Le nom affiché de chaque facturier, le même que dans les réglages. */
export const BILLING_PROVIDER_LABELS: Readonly<Record<BillingProviderKind, string>> = {
  hostbill: "HostBill",
  whmcs: "WHMCS",
  clientxcms: "ClientXCMS",
};

/** La valeur de `billing.provider`, si c'est un facturier lisible ; sinon `null`. */
export function readableBillingProvider(raw: unknown): BillingProviderKind | null {
  return typeof raw === "string" && (BILLING_PROVIDERS as readonly string[]).includes(raw)
    ? (raw as BillingProviderKind)
    : null;
}

export type BilledServiceState = "active" | "suspended" | "pending" | "cancelled" | "unknown";

export interface BilledService {
  id: string;
  name: string;
  /** Formule facturée, telle que le facturier la nomme. Nulle si absente. */
  plan: string | null;
  state: BilledServiceState;
  /** Prochaine échéance, en `AAAA-MM-JJ`. Nulle pour un service sans terme. */
  dueDate: string | null;
  /**
   * Jours restants avant l'échéance, ou `null` quand il n'y en a pas.
   *
   * Négatif quand la date est passée : un service en retard doit se voir, et
   * ramener à zéro ferait dire « échéance aujourd'hui » à une facture impayée
   * depuis trois semaines.
   */
  daysLeft: number | null;
  /** Montant du prochain terme, tel quel. Nul si le facturier ne le donne pas. */
  amount: string | null;
  currency: string | null;
}

export interface BillingSummary {
  /** Faux tant que l'administrateur n'a pas choisi un facturier et renseigné son API. */
  configured: boolean;
  /**
   * Le facturier relié, pour que l'écran le nomme au lieu de dire « HostBill »
   * à tout le monde. Nul quand rien n'est configuré.
   */
  provider: BillingProviderKind | null;
  /**
   * Vrai quand le facturier n'a pas répondu.
   *
   * Distinct d'une liste vide : « nous n'avons pas pu demander » et « vous
   * n'avez aucun service » n'appellent pas le même écran, et le second est une
   * affirmation qu'on n'a pas le droit de faire sans réponse.
   */
  unreachable: boolean;
  services: BilledService[];
  /** Adresse de l'espace client, pour régler une facture. Nulle si non réglée. */
  clientUrl: string | null;
}

export const BILLING_SILENT: BillingSummary = {
  configured: false,
  provider: null,
  unreachable: false,
  services: [],
  clientUrl: null,
};

/**
 * Seuil à partir duquel une échéance est signalée.
 *
 * Sept jours : assez tôt pour qu'un virement ait le temps d'arriver, assez
 * tard pour que l'avertissement ne devienne pas un décor qu'on cesse de voir.
 */
export const BILLING_DUE_SOON_DAYS = 7;

export function isDueSoon(service: BilledService): boolean {
  return service.daysLeft !== null && service.daysLeft <= BILLING_DUE_SOON_DAYS;
}

/**
 * Jours restants entre aujourd'hui et une échéance.
 *
 * Le calcul se fait sur des **dates**, pas sur des instants : une échéance au
 * 1er mars est due le 1er mars, quelle que soit l'heure qu'il est. Compter en
 * millisecondes puis diviser ferait afficher « 0 jour » tout l'après-midi de
 * la veille, puis « -1 » le matin même.
 */
export function daysUntil(dueDate: string, today: Date = new Date()): number | null {
  const due = parseDateOnly(dueDate);
  if (due === null) return null;

  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((due - start) / 86_400_000);
}

/** `AAAA-MM-JJ` en millisecondes UTC, ou `null` si la forme n'y est pas. */
function parseDateOnly(value: string): number | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // HostBill et WHMCS écrivent « 0000-00-00 » pour « pas d'échéance ». Une date nulle
  // traversée telle quelle donnerait un compte à rebours de sept cent mille
  // jours affiché en toutes lettres.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return Date.UTC(year, month - 1, day);
}

/**
 * Les états des trois facturiers, ramenés aux nôtres. Tout le reste est `unknown`.
 *
 * Un seul tableau pour les trois : leurs mots se recouvrent presque tous, et
 * trois traductions séparées finiraient par ne plus dire la même chose d'un
 * même état. `terminated` (HostBill, WHMCS), `completed` (WHMCS) et `expired`
 * (ClientXCMS) sont des fins de service, donc `cancelled`.
 */
export function readServiceState(raw: unknown): BilledServiceState {
  if (typeof raw !== "string") return "unknown";
  switch (raw.trim().toLowerCase()) {
    case "active":
      return "active";
    case "suspended":
      return "suspended";
    case "pending":
      return "pending";
    case "cancelled":
    case "canceled":
    case "terminated":
    case "completed":
    case "expired":
      return "cancelled";
    default:
      return "unknown";
  }
}
