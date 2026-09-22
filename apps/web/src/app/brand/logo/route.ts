import { DEFAULT_BRANDING } from "@gamedashboard/contracts";
import { getBranding } from "@/server/api/branding";

/**
 * Logo de la marque servie, à une adresse **stable**.
 *
 * Une redirection plutôt qu'un chemin passé de composant en composant : le
 * logo apparaît sur l'écran de démarrage, la carte de connexion, l'en-tête et
 * la page d'état, dont plusieurs sont des composants client qui n'ont pas
 * accès à l'hôte de la requête. Une adresse fixe, qui sait par quel domaine on
 * est arrivé, les sert tous sans les modifier.
 *
 * `307` et non `301` : la cible dépend du domaine et change quand le revendeur
 * change son logo. Une redirection permanente resterait dans les navigateurs
 * bien après.
 */
export async function GET(): Promise<Response> {
  const branding = await getBranding();
  return redirectToImage(branding.logoUrl, DEFAULT_BRANDING.logoUrl);
}

/**
 * Renvoie vers l'image, ou vers celle du produit si la valeur n'est pas une
 * destination acceptable.
 *
 * L'API contrôle déjà ce qu'elle enregistre ; ce second contrôle tient au fait
 * qu'on écrit ici un en-tête `Location`. Une valeur inattendue — `javascript:`,
 * un protocole exotique — y enverrait le navigateur sans autre forme de procès.
 */
export function redirectToImage(url: string, fallback: string): Response {
  const target = url.startsWith("https://") || url.startsWith("/") ? url : fallback;

  return new Response(null, {
    status: 307,
    headers: {
      // Un `Location` relatif est licite, et c'est le seul moyen de rester sur
      // le domaine par lequel on est arrivé — il y en a autant que de
      // revendeurs, et les nommer ici demanderait de tous les connaître.
      location: target,
      "cache-control": "public, max-age=60",
    },
  });
}
