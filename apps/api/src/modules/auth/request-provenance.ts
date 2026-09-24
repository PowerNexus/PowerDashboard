import { foreignProvenance, hostOfOrigin } from "@gamedashboard/contracts";

/**
 * Une écriture par cookie venue d'un autre site (NC-02).
 *
 * Deux sources, et la requête est refusée dès que l'une accuse :
 *
 * - **ce que Next relaie** : le navigateur ne parle qu'à Next, qui appelle
 *   l'API depuis la machine. Les en-têtes du navigateur s'arrêtent donc chez
 *   Next, qui les transmet sous `x-gd-origin` et `x-gd-fetch-site`
 *   (`apps/web/src/server/api/forwarded.ts`), avec l'hôte d'arrivée
 *   (`x-gd-host`) ;
 * - **ce que dit un navigateur qui atteindrait l'API directement** : `origin`
 *   et `sec-fetch-site` réels. nginx ne publie pas l'API cliente, mais la
 *   règle ne doit pas dépendre d'un réglage de déploiement.
 *
 * Ces en-têtes se forgent, et ce n'est pas un problème : ils ne peuvent que
 * **faire refuser**. Celui qui les écrit à la main n'est pas un navigateur
 * abusé, c'est le porteur du cookie lui-même.
 *
 * Les lectures passent : un lien suivi depuis un courriel arrive en
 * `cross-site`, et la page doit s'afficher. Une méthode absente est traitée
 * comme une écriture — fermé par défaut.
 */

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type Headers = Record<string, string | string[] | undefined>;

function header(headers: Headers, name: string): string | null {
  const value = headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export function crossSiteCookieWrite(
  request: { method?: string; headers?: Headers },
  panelOrigin: string = process.env.PANEL_ORIGIN ?? "http://localhost:3000",
): boolean {
  if (request.method && READ_METHODS.has(request.method.toUpperCase())) return false;

  const headers = request.headers ?? {};
  const panelHosts = [hostOfOrigin(panelOrigin), header(headers, "x-gd-host")];

  return (
    foreignProvenance(
      { origin: header(headers, "origin"), fetchSite: header(headers, "sec-fetch-site") },
      panelHosts,
    ) ||
    foreignProvenance(
      { origin: header(headers, "x-gd-origin"), fetchSite: header(headers, "x-gd-fetch-site") },
      panelHosts,
    )
  );
}
