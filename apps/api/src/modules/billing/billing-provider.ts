import { type BilledService, type BillingProviderKind, daysUntil } from "@gamedashboard/contracts";

/**
 * Ce qu'un facturier doit savoir faire pour le panel : retrouver un client,
 * et lister ses services. Rien d'autre, et surtout rien qui écrive.
 *
 * HostBill, WHMCS et ClientXCMS ont chacun leur protocole, leurs noms de champs
 * et leur manière de dire « refusé ». Chaque implémentation traduit le sien ;
 * la façade (`BillingService`) garde pour elle ce qui ne doit pas varier d'un
 * facturier à l'autre : la vérification de l'adresse, le silence quand rien
 * n'est réglé, et « injoignable » distinct de « aucun service ».
 *
 * Une implémentation **lève** quand le facturier ne répond pas ou refuse
 * l'appel, et rend une valeur vide quand il répond qu'il ne connaît pas le
 * client : ce sont deux réponses différentes, et l'écran ne dit pas la même
 * chose des deux.
 */
export interface BillingProvider {
  readonly kind: BillingProviderKind;

  /** La fiche d'un client par son identifiant chez le facturier, ou `null`. */
  clientById(connection: BillingConnection, id: string): Promise<BillingClient | null>;

  /**
   * Les clients dont l'adresse **ressemble** à celle-ci.
   *
   * Plusieurs facturiers filtrent en recherche partielle : la liste peut
   * contenir `paul@ex.fr.co` quand on demande `paul@ex.fr`. C'est la façade qui
   * retient l'adresse exacte, une fois pour les trois.
   */
  clientsByEmail(connection: BillingConnection, email: string): Promise<BillingClient[]>;

  /** Les services d'un client, déjà traduits, toutes pages lues. */
  servicesOf(connection: BillingConnection, clientId: string): Promise<BilledService[]>;
}

/** Les réglages `billing.*`, relus et déchiffrés à chaque demande. */
export interface BillingConnection {
  apiUrl: string;
  /** Vide pour un facturier qui n'emploie qu'un jeton (ClientXCMS). */
  apiId: string;
  apiKey: string;
}

export interface BillingClient {
  id: string;
  email: string;
}

/**
 * Nombre maximal de pages lues pour une même liste.
 *
 * Borne de sûreté, pas de pagination : un facturier qui rendrait toujours une
 * page « suivante » ferait tourner la veille horaire sans fin. Cent services
 * par page chez WHMCS et ClientXCMS, vingt pages : aucun client réel n'en
 * approche.
 */
export const MAX_PAGES = 20;

/**
 * Une ligne de service, une fois les champs du facturier lus.
 *
 * Le compte à rebours se calcule ici, pour les trois : c'est le calcul qu'on
 * rate d'un jour (`daysUntil`), et il ne doit exister qu'une fois.
 */
export function billedService(fields: {
  id: string;
  name: string | null;
  plan: string | null;
  state: BilledService["state"];
  dueDate: string | null;
  amount: string | null;
  currency: string | null;
}): BilledService {
  // Une échéance en date et heure (ClientXCMS) se ramène à sa date : c'est
  // elle qu'on affiche et qu'on compte.
  const dueDate = fields.dueDate?.trim().slice(0, 10) || null;
  const daysLeft = dueDate ? daysUntil(dueDate) : null;
  return {
    id: fields.id,
    // Une ligne anonyme ne se reconnaît pas : le numéro sert de dernier repli.
    name: fields.name ?? fields.plan ?? `#${fields.id}`,
    plan: fields.plan,
    state: fields.state,
    // Une date nulle (« 0000-00-00 ») n'est pas une échéance.
    dueDate: daysLeft === null ? null : dueDate,
    daysLeft,
    amount: fields.amount,
    currency: fields.currency,
  };
}
