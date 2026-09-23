import { headers } from "next/headers";

/**
 * Relaie à l'API qui est réellement à l'autre bout.
 *
 * Le navigateur ne parle jamais à l'API : il parle à Next, qui parle à l'API.
 * L'API voit donc, pour tout le monde, la même adresse — `127.0.0.1` — et le
 * même agent — `node`, celui du `fetch` de Next. C'est ce qui donnait une liste
 * de sessions où chaque appareil s'appelait « node » et venait de la boucle
 * locale.
 *
 * Ce n'est pas qu'un défaut d'affichage. La limitation des tentatives de
 * connexion compte **par adresse** : avec une seule adresse pour tous, elle
 * additionne les échecs de tout le monde. Un seul visiteur maladroit
 * verrouillerait la connexion de l'ensemble des clients, et un attaquant
 * bénéficierait au contraire d'un compteur partagé qu'il n'a pas à épuiser
 * seul. Réparer l'affichage répare aussi cela.
 *
 * Rien ici n'est une preuve d'identité : un en-tête se falsifie. Ces valeurs ne
 * servent qu'à reconnaître sa propre session dans une liste, et à répartir un
 * compteur — jamais à accorder un droit.
 */
export async function forwardedIdentityHeaders(): Promise<Record<string, string>> {
  const incoming = await headers();
  const forwarded: Record<string, string> = {};

  /*
   * `x-forwarded-for` s'ajoute, il ne se remplace pas.
   *
   * nginx y a déjà inscrit l'adresse du visiteur ; Next est un intermédiaire de
   * plus sur le trajet et doit se contenter de transmettre la chaîne. La
   * réécrire ferait disparaître les intermédiaires précédents, et avec eux la
   * possibilité de savoir d'où vient vraiment la requête.
   */
  const chain = incoming.get("x-forwarded-for");
  if (chain) forwarded["x-forwarded-for"] = chain;

  const proto = incoming.get("x-forwarded-proto");
  if (proto) forwarded["x-forwarded-proto"] = proto;

  /*
   * L'agent du navigateur prend la place de celui de Node.
   *
   * Next agit ici pour le compte de ce navigateur : annoncer `node` serait à la
   * fois faux et inutilisable. Tronqué, parce que la colonne qui le reçoit est
   * bornée et qu'un en-tête arbitrairement long n'apprend rien de plus.
   */
  const agent = incoming.get("user-agent");
  if (agent) forwarded["user-agent"] = agent.slice(0, 400);

  /*
   * Le domaine d'arrivée, pour la marque blanche.
   *
   * Un seul vhost sert tous les domaines des revendeurs : côté API, l'hôte de
   * la requête est celui du service interne, et sans cet en-tête aucune route
   * ne pourrait savoir qu'on est arrivé par `panel.revendeur.fr`. Il décide de
   * la marque affichée et du domaine des liens envoyés par courrier.
   *
   * Comme les autres : ce n'est pas une preuve. Un hôte falsifié ne donne
   * qu'un logo et une couleur, jamais un accès.
   */
  const host = requestHost(incoming);
  if (host) forwarded["x-gd-host"] = host;

  /*
   * Le pays, quand un frontal Cloudflare l'a posé.
   *
   * Il ne sert qu'à l'alerte « nouvelle connexion » (§5.1), et l'API ne le
   * croit que s'il lui arrive d'un intermédiaire de `TRUSTED_PROXIES`. Même
   * statut que les autres : un repère affiché au titulaire, jamais un droit.
   */
  const country = incoming.get("cf-ipcountry");
  if (country) forwarded["cf-ipcountry"] = country.slice(0, 8);

  return forwarded;
}

/**
 * Domaine par lequel le navigateur est arrivé.
 *
 * `x-forwarded-host` d'abord : derrière nginx, `host` est celui du service
 * interne, et c'est le premier qui porte le domaine public. Le port est retiré
 * — un domaine de revendeur se déclare sans port, et le garder ferait échouer
 * la comparaison sur un développement en `:3000`.
 */
export function requestHost(incoming: { get(name: string): string | null }): string | null {
  const raw = incoming.get("x-forwarded-host") ?? incoming.get("host");
  const host = raw?.split(",")[0]?.trim().toLowerCase().replace(/:\d+$/, "") ?? "";
  return host === "" ? null : host;
}

/** Même lecture, depuis les en-têtes de la requête en cours. */
export async function currentHost(): Promise<string | null> {
  return requestHost(await headers());
}
