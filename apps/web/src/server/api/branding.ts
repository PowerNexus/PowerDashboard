import { type Branding, DEFAULT_BRANDING } from "@gamedashboard/contracts";
import { cache } from "react";
import { currentHost } from "./forwarded";

/**
 * Marque à servir pour la requête en cours.
 *
 * **C'est le domaine d'arrivée qui décide**, pas le compte : la page de
 * connexion doit déjà porter la marque du revendeur, et à ce moment-là
 * personne n'est identifié. Un client peut d'ailleurs louer chez deux
 * revendeurs — le domaine, lui, est sans ambiguïté.
 *
 * **Un seul vhost sert tous les domaines.** Rien n'est à configurer côté
 * serveur web quand un revendeur branche le sien : l'hôte voyage dans un
 * en-tête jusqu'à l'API, qui répond la marque correspondante.
 */
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";

/**
 * Au-delà, on rend la marque de la plateforme plutôt que de retarder la page.
 *
 * Une marque est un ornement : la faire attendre une API lente ferait payer à
 * tout le monde, sur chaque rendu, une panne qui ne concerne qu'un logo.
 */
const TIMEOUT_MS = 2_000;

/**
 * Mémorisé pour la durée du rendu.
 *
 * `layout`, la coquille et la page appellent tous la même chose ; sans ce
 * cache, un seul affichage coûterait trois appels pour une valeur identique.
 */
export const getBranding = cache(async (): Promise<Branding> => {
  const host = await currentHost();
  if (host === null) return DEFAULT_BRANDING;

  try {
    const response = await fetch(`${API_URL}/api/v1/branding?host=${encodeURIComponent(host)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Une minute : le revendeur voit son changement sans comprendre pourquoi
      // il attend, et la rafale de requêtes d'un chargement n'en paie qu'une.
      next: { revalidate: 60, tags: ["branding"] },
    });
    if (!response.ok) return DEFAULT_BRANDING;

    const body = (await response.json()) as { data?: Branding };
    return body.data ?? DEFAULT_BRANDING;
  } catch {
    /*
     * L'API muette ne doit pas noircir l'écran.
     *
     * On retombe sur la marque du produit : un client d'un revendeur verra
     * brièvement le mauvais logo, ce qui est sans commune mesure avec une page
     * qui ne s'affiche pas.
     */
    return DEFAULT_BRANDING;
  }
});
