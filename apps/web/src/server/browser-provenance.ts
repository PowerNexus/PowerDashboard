import { foreignProvenance, hostOfOrigin } from "@gamedashboard/contracts";
import { requestHost } from "./api/forwarded";

/**
 * Contrôle d'origine des relais de Next qui ne sont pas des actions serveur
 * (NC-02) : jeton de console, morceaux d'un envoi.
 *
 * Une action serveur est protégée par Next lui-même, qui refuse une requête
 * dont l'`Origin` n'est pas l'hôte. Un gestionnaire de route, non : sans ce
 * contrôle, un site tiers ferait envoyer la requête par le navigateur d'un
 * visiteur connecté, cookie joint, `SameSite=Lax` mis à part.
 *
 * La règle est celle de l'API (`@gamedashboard/contracts`) : refusé si le
 * navigateur dit `cross-site` ou `same-site`, ou si l'origine n'est ni celle
 * de `PANEL_ORIGIN` ni l'hôte par lequel la requête est arrivée — le domaine
 * d'un revendeur sert le même panel. `PANEL_ORIGIN` est lue à chaque requête,
 * pas au chargement du module.
 */
export function crossSiteRequest(request: Request): boolean {
  return foreignProvenance(
    {
      origin: request.headers.get("origin"),
      fetchSite: request.headers.get("sec-fetch-site"),
    },
    [hostOfOrigin(process.env.PANEL_ORIGIN), requestHost(request.headers)],
  );
}
