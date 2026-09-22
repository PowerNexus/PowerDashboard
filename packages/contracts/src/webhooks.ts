/**
 * Webhooks sortants : ce que le panel raconte au système tiers.
 *
 * L'API applicative va dans un sens — la boutique demande, le panel exécute.
 * Les webhooks vont dans l'autre : le panel constate, et le dit. Les deux sont
 * nécessaires, parce que l'essentiel de ce qui arrive à un serveur n'arrive pas
 * pendant une requête HTTP. Une installation dure plusieurs minutes et se
 * termine bien après que la boutique a raccroché ; sans rappel, elle ne peut
 * qu'interroger en boucle, ce qui coûte à tout le monde et répond tard.
 */

export const WEBHOOK_EVENTS = [
  /** Le serveur est inscrit et le node a été prévenu. Il n'est pas encore installé. */
  "server.created",
  /** Le script d'installation a réussi : le serveur est utilisable. C'est le moment d'écrire au client. */
  "server.installed",
  /** Le script a échoué. Le serveur existe, il ne démarre pas. */
  "server.install_failed",
  /** Les limites du serveur ont changé — montée ou descente en gamme. */
  "server.resized",
  "server.suspended",
  "server.resumed",
  "server.deleted",
  "user.created",
  "user.deleted",
  /**
   * Le daemon d'un node ne répond plus depuis plus de deux minutes.
   *
   * Émis une fois par indisponibilité, pas à chaque balayage : c'est un
   * changement d'état qu'on annonce, pas une mesure qu'on répète.
   */
  "node.unreachable",
  /** Le daemon a reparlé. Nécessaire pour clore ce que le précédent a ouvert. */
  "node.recovered",
  /**
   * Un serveur a été arrêté parce que la part de son revendeur dépassait.
   *
   * Un arrêt subi est un motif de contact client, et la boutique est seule à
   * savoir quoi en faire : relever l'enveloppe, facturer le dépassement, ou
   * simplement prévenir. Le panel, lui, se contente de rendre la mémoire.
   */
  "server.quota_stopped",
  /**
   * Un serveur change de machine.
   *
   * Trois événements plutôt qu'un seul portant un état : le départ interrompt
   * le service, l'arrivée lui donne une **nouvelle adresse** — que la boutique
   * doit communiquer à son client — et l'échec n'appelle ni l'un ni l'autre.
   * Un abonné qui ne veut être prévenu que du changement d'adresse ne doit pas
   * avoir à recevoir les trois pour les trier lui-même.
   */
  "server.transfer_started",
  "server.transfer_completed",
  "server.transfer_failed",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

export interface WebhookEventGroup {
  readonly key: string;
  readonly label: string;
  readonly events: readonly { readonly event: WebhookEvent; readonly label: string }[];
}

/**
 * Catalogue pour l'écran d'administration.
 *
 * Comme pour les portées : un événement absent d'ici serait émis par le panel
 * mais impossible à cocher, donc reçu par personne.
 */
export const WEBHOOK_EVENT_CATALOGUE: readonly WebhookEventGroup[] = [
  {
    key: "servers",
    label: "Serveurs",
    events: [
      { event: "server.created", label: "Serveur créé (installation en cours)" },
      { event: "server.installed", label: "Installation terminée — le serveur est prêt" },
      { event: "server.install_failed", label: "Installation échouée" },
      { event: "server.resized", label: "Limites du serveur modifiées" },
      { event: "server.suspended", label: "Serveur suspendu" },
      { event: "server.resumed", label: "Serveur rétabli" },
      { event: "server.deleted", label: "Serveur supprimé" },
      { event: "server.transfer_started", label: "Déplacement commencé — le serveur est arrêté" },
      {
        event: "server.transfer_completed",
        label: "Déplacement terminé — le serveur a changé d'adresse",
      },
      { event: "server.transfer_failed", label: "Déplacement échoué — le serveur n'a pas bougé" },
    ],
  },
  {
    key: "users",
    label: "Comptes",
    events: [
      { event: "user.created", label: "Compte créé" },
      { event: "user.deleted", label: "Compte supprimé" },
    ],
  },
  {
    key: "infrastructure",
    label: "Infrastructure",
    events: [
      {
        event: "node.unreachable",
        label: "Node injoignable — les serveurs qu'il héberge sont coupés",
      },
      { event: "node.recovered", label: "Node de nouveau joignable" },
      {
        event: "server.quota_stopped",
        label: "Serveur arrêté — la part de mémoire du revendeur était dépassée",
      },
    ],
  },
];

/** Corps envoyé, quel que soit l'événement. */
export interface WebhookPayload {
  /** Identifiant de **livraison**, stable entre les tentatives : de quoi dédoublonner à la réception. */
  id: string;
  event: WebhookEvent;
  /** Horodatage de l'événement, pas de la tentative. Une reprise à J+1 le dit. */
  at: string;
  data: Record<string, unknown>;
}

/* --- Signature ------------------------------------------------------------ */

export const WEBHOOK_SIGNATURE_HEADER = "x-gamedashboard-signature";
export const WEBHOOK_EVENT_HEADER = "x-gamedashboard-event";
export const WEBHOOK_DELIVERY_HEADER = "x-gamedashboard-delivery";

/**
 * Ce qui est réellement signé : l'horodatage **et** le corps.
 *
 * Signer le corps seul rendrait une livraison rejouable indéfiniment : un
 * intermédiaire qui la capte pourrait la renvoyer un an plus tard, avec une
 * signature toujours valable, et faire rouvrir un service résilié. En liant
 * l'horodatage à la signature, le receveur peut refuser ce qui est trop vieux.
 */
export function webhookSignaturePayload(timestampSeconds: number, body: string): string {
  return `${timestampSeconds}.${body}`;
}

/** En-tête complet, au format `t=…,v1=…` : versionné pour pouvoir changer d'algorithme. */
export function webhookSignatureHeader(timestampSeconds: number, hmacHex: string): string {
  return `t=${timestampSeconds},v1=${hmacHex}`;
}

export interface ParsedWebhookSignature {
  timestampSeconds: number;
  v1: string;
}

/** Relit l'en-tête. Rendu ici pour que l'intégrateur puisse s'en servir tel quel. */
export function parseWebhookSignature(header: string): ParsedWebhookSignature | null {
  const parts = new Map(
    header
      .split(",")
      .map((chunk) => chunk.trim().split("="))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([k, v]) => [k, v] as const),
  );

  const t = Number(parts.get("t"));
  const v1 = parts.get("v1");
  if (!Number.isFinite(t) || !v1) return null;
  return { timestampSeconds: t, v1 };
}

/**
 * Âge maximal accepté par un receveur raisonnable.
 *
 * Cinq minutes : assez large pour absorber une horloge mal réglée et une file
 * un peu lente, assez court pour qu'une capture ne serve pas longtemps. La
 * valeur est publiée ici parce que c'est le receveur qui l'applique — la
 * documenter ailleurs qu'à côté de la signature garantirait qu'elle diverge.
 */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

/* --- Reprise -------------------------------------------------------------- */

/**
 * Délais entre tentatives, en millisecondes.
 *
 * Croissants et bornés : une panne de trente secondes se rattrape tout de
 * suite, une panne d'une nuit se rattrape au matin, et un point d'entrée mort
 * cesse d'être appelé au bout d'un jour plutôt que d'accumuler des tentatives
 * jusqu'à saturer la table.
 */
export const WEBHOOK_RETRY_DELAYS_MS = [
  30_000, // 30 s
  120_000, // 2 min
  600_000, // 10 min
  3_600_000, // 1 h
  21_600_000, // 6 h
  86_400_000, // 24 h
] as const;

/** Nombre total de tentatives : la première, plus les reprises. */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_MS.length + 1;

/**
 * Délai avant la tentative suivante, ou `null` s'il faut renoncer.
 *
 * `null` est une valeur de retour, pas une erreur : renoncer est une issue
 * normale, et la distinguer d'un délai de zéro évite une boucle qui retente
 * sans fin sur un point d'entrée définitivement mort.
 */
export function webhookRetryDelayMs(attempt: number): number | null {
  if (attempt < 1) return null;
  return WEBHOOK_RETRY_DELAYS_MS[attempt - 1] ?? null;
}

/**
 * Une réponse mérite-t-elle une reprise ?
 *
 * Les 4xx **non**, sauf 408 et 429 : un 400 ou un 404 se reproduira à
 * l'identique au prochain essai — le point d'entrée n'existe pas, ou refuse ce
 * corps. Insister pendant vingt-quatre heures ne changerait rien et masquerait
 * l'erreur de configuration derrière une file qui s'allonge.
 */
export function webhookShouldRetry(status: number | null): boolean {
  if (status === null) return true; // Aucune réponse : panne réseau, donc temporaire.
  if (status === 408 || status === 429) return true;
  if (status >= 400 && status < 500) return false;
  return status >= 500;
}
