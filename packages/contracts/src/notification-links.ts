/**
 * Où mène une notification.
 *
 * Une cloche qui annonce sans conduire fait faire le travail deux fois : on
 * lit « votre serveur s'est arrêté », puis on cherche lequel dans la liste.
 * Chaque notification porte donc une destination, et celle-ci est **déduite
 * de son type**, pas recopiée à la main par chaque émetteur — un lien écrit
 * trente fois est un lien faux vingt-neuf fois.
 *
 * Le calcul est ici, sans réseau ni base, pour la même raison que le compte à
 * rebours des échéances : c'est le genre de règle qu'on se trompe d'un chemin,
 * et qu'un test doit tenir.
 */

/** Données rangées dans `notifications.data`, telles qu'on les relit. */
export interface NotificationTarget {
  serverId?: string | null;
  nodeId?: string | null;
  /**
   * Adresse déjà résolue par l'émetteur, qui l'emporte sur tout le reste.
   *
   * C'est par là qu'arrive l'espace client du facturier : le panel ne sait pas
   * bâtir ses URL, il ne connaît que celle que l'administrateur a réglée.
   */
  href?: string | null;
}

/**
 * Destination d'une notification, ou `null` quand il n'y a rien à ouvrir.
 *
 * `null` est un résultat légitime — une notification purement informative n'a
 * pas à être cliquable, et rendre une adresse par défaut ferait atterrir sur
 * l'accueil quelqu'un qui croyait aller quelque part.
 */
export function resolveNotificationHref(type: string, target: NotificationTarget): string | null {
  if (typeof target.href === "string" && target.href !== "") return target.href;

  // Les événements de facturation n'ont pas de page dans le panel : c'est
  // délibéré, le panel lit la facturation et n'y écrit rien. Sans adresse
  // d'espace client réglée, il n'y a donc nulle part où aller.
  if (type.startsWith("billing.")) return null;

  if (target.serverId) {
    // La console est la page utile d'un serveur : c'est là qu'on voit ce qui
    // se passe, et les autres pages sont à un clic de là.
    if (type.startsWith("server.backup")) return `/server/${target.serverId}/backups`;
    if (type.startsWith("server.quota")) return `/server/${target.serverId}`;
    return `/server/${target.serverId}`;
  }

  if (target.nodeId) return `/admin/nodes`;

  return null;
}

/** Une adresse hors du panel s'ouvre autrement qu'une page interne. */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}
