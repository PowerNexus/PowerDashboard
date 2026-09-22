/**
 * Rappels sortants **d'un client**, sur **son** serveur.
 *
 * À ne pas confondre avec `WEBHOOK_EVENTS`, qui décrit les rappels de la
 * plateforme vers un système tiers — la boutique, la facturation. Les deux
 * mécanismes partagent leur signature, leurs réessais et leur format ; ils ne
 * partagent ni leur public ni leur portée :
 *
 * - les rappels **applicatifs** parlent de tout le parc à un partenaire, et se
 *   règlent depuis l'administration ;
 * - ceux-ci parlent d'**un seul serveur** à son propriétaire, et se règlent
 *   depuis l'écran de ce serveur. L'usage courant est un salon Discord prévenu
 *   quand le serveur tombe ou qu'une sauvegarde échoue.
 *
 * Les confondre donnerait à un client la liste des comptes de la plateforme.
 */

/**
 * Événements proposables, et **rien d'autre**.
 *
 * Cette liste n'est pas un souhait : elle décrit exactement ce que
 * `NotificationsService.notifyServerOwner` émet aujourd'hui. Un écran qui
 * proposerait de s'abonner à « serveur démarré » alors que rien ne l'émet
 * ferait attendre indéfiniment un message qui ne viendra pas — et c'est
 * indétectable côté client, puisque l'absence d'événement ressemble à un
 * serveur qui n'a rien fait.
 *
 * Un test vérifie que cette liste et les appels réels restent d'accord. Le jour
 * où un nouvel événement serveur est émis, il échoue jusqu'à ce qu'on l'ajoute
 * ici — ce qui est le bon sens de la contrainte : on découvre qu'on peut
 * offrir quelque chose de plus, pas qu'on a menti.
 */
export const CLIENT_WEBHOOK_EVENTS = [
  "server.installed",
  "server.transferred",
  "server.transfer_failed",
  "server.quota_stopped",
  "backup.failed",
] as const;

export type ClientWebhookEvent = (typeof CLIENT_WEBHOOK_EVENTS)[number];

export function isClientWebhookEvent(value: string): value is ClientWebhookEvent {
  return (CLIENT_WEBHOOK_EVENTS as readonly string[]).includes(value);
}

export interface ClientWebhookEventDescriptor {
  event: ClientWebhookEvent;
  label: string;
  description: string;
}

/** Ce que chaque événement annonce, en clair, pour l'écran de réglage. */
export const CLIENT_WEBHOOK_CATALOGUE: readonly ClientWebhookEventDescriptor[] = [
  {
    event: "server.installed",
    label: "Installation terminée",
    description: "Le serveur est prêt à démarrer pour la première fois.",
  },
  {
    event: "server.transferred",
    label: "Serveur déplacé",
    description: "Le serveur tourne désormais sur une autre machine — son adresse a changé.",
  },
  {
    event: "server.transfer_failed",
    label: "Déplacement interrompu",
    description: "Le déménagement a échoué ; le serveur est resté sur sa machine d'origine.",
  },
  {
    event: "server.quota_stopped",
    label: "Arrêté faute de quota",
    description: "La plateforme a arrêté le serveur pour rendre de la mémoire.",
  },
  {
    event: "backup.failed",
    label: "Sauvegarde échouée",
    description: "Une sauvegarde ne s'est pas terminée. Rien n'a été écrit.",
  },
];

/**
 * Adresse acceptable pour un rappel.
 *
 * `https` **exigé**, et pas seulement conseillé : le corps porte les
 * identifiants du serveur, et la signature ne protège que de la contrefaçon,
 * pas de la lecture. En clair sur le réseau, n'importe quel intermédiaire lit
 * ce qui se passe chez le client.
 *
 * La boucle locale et les adresses privées sont refusées : le panel émet ces
 * requêtes depuis **sa** machine, et une adresse interne ferait de lui un
 * relais vers son propre réseau — un client déclarerait `http://127.0.0.1:5432`
 * et se servirait du panel pour sonder ses ports.
 */
export function isAcceptableWebhookUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "::1" || host === "0.0.0.0") return false;

  /*
   * Plages privées, en IPv4 littéral.
   *
   * Un nom de domaine qui *résout* vers une adresse privée passe ce contrôle :
   * le vérifier exigerait de résoudre le nom ici, et la réponse pourrait
   * changer entre la vérification et l'envoi. Ce filtre écarte l'évident ; la
   * protection réelle contre ce détournement est ailleurs — le panel ne rend
   * jamais le corps de la réponse d'un rappel au client, seulement son code.
   */
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
  }

  return true;
}
