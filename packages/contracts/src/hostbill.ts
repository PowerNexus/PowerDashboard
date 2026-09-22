/**
 * Lecture de la facturation HostBill.
 *
 * Le panel **lit** HostBill, il n'y écrit rien. La facturation reste chez le
 * tiers, qui pilote le panel par l'API applicative ; l'inverse — un panel qui
 * créerait des factures — ferait deux systèmes responsables du même chiffre,
 * et deux réponses différentes le jour où ils divergent.
 *
 * Ce module traduit et calcule. Il ne connaît ni le réseau ni les réglages :
 * le compte à rebours d'une échéance doit pouvoir être éprouvé sans eux, parce
 * que c'est exactement le genre de calcul qu'on rate d'un jour.
 */

export type HostbillServiceState = "active" | "suspended" | "pending" | "cancelled" | "unknown";

export interface HostbillService {
  id: string;
  name: string;
  /** Formule facturée, telle que HostBill la nomme. Nulle si absente. */
  plan: string | null;
  state: HostbillServiceState;
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
  /** Montant du prochain terme, tel quel. Nul si HostBill ne le donne pas. */
  amount: string | null;
  currency: string | null;
}

export interface HostbillSummary {
  /** Faux tant que l'administrateur n'a pas renseigné les trois réglages. */
  configured: boolean;
  /**
   * Vrai quand HostBill n'a pas répondu.
   *
   * Distinct d'une liste vide : « nous n'avons pas pu demander » et « vous
   * n'avez aucun service » n'appellent pas le même écran, et le second est une
   * affirmation qu'on n'a pas le droit de faire sans réponse.
   */
  unreachable: boolean;
  services: HostbillService[];
  /** Adresse de l'espace client, pour régler une facture. Nulle si non réglée. */
  clientUrl: string | null;
}

export const HOSTBILL_SILENT: HostbillSummary = {
  configured: false,
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
export const HOSTBILL_DUE_SOON_DAYS = 7;

export function isDueSoon(service: HostbillService): boolean {
  return service.daysLeft !== null && service.daysLeft <= HOSTBILL_DUE_SOON_DAYS;
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
  // HostBill écrit « 0000-00-00 » pour « pas d'échéance ». Une date nulle
  // traversée telle quelle donnerait un compte à rebours de sept cent mille
  // jours affiché en toutes lettres.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return Date.UTC(year, month - 1, day);
}

/** Les états de HostBill, ramenés aux nôtres. Tout le reste est `unknown`. */
export function readServiceState(raw: unknown): HostbillServiceState {
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
      return "cancelled";
    default:
      return "unknown";
  }
}
