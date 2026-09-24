/**
 * D'où vient une requête, selon le navigateur qui l'envoie (NC-02).
 *
 * Défense contre la falsification de requête intersite (CSRF) : un site tiers
 * fait soumettre par le navigateur d'un visiteur connecté une requête vers le
 * panel, et le navigateur y joint le cookie de session. `SameSite=Lax` arrête
 * déjà l'essentiel ; ce contrôle en est la seconde ligne, pour ce que `Lax`
 * laisse passer (un sous-domaine voisin) et pour le jour où un réglage du
 * cookie changerait.
 *
 * Deux en-têtes, que le navigateur pose lui-même et qu'aucune page ne peut
 * écrire à sa place :
 *
 * - `Sec-Fetch-Site` dit la relation entre la page qui envoie et la cible :
 *   `same-origin`, `same-site`, `cross-site`, ou `none` (navigation tapée) ;
 * - `Origin` dit l'origine de la page, sur toute requête qui n'est pas une
 *   lecture.
 *
 * Leur **absence** ne dit rien contre la requête : un client qui n'est pas un
 * navigateur (curl, une intégration, Next lui-même) n'en envoie pas, et sans
 * navigateur il n'y a personne à qui faire envoyer un cookie à son insu.
 *
 * La règle vit ici parce que deux couches l'appliquent : l'API
 * (`SessionGuard`) et les relais de Next qui ne sont pas des actions serveur.
 * Deux copies finiraient par diverger.
 */

/** Ce que le navigateur a déclaré. `null` ou absent : l'en-tête manquait. */
export interface BrowserProvenance {
  /** En-tête `Origin`. */
  origin?: string | null;
  /** En-tête `Sec-Fetch-Site`. */
  fetchSite?: string | null;
}

/**
 * Les seules relations admises.
 *
 * `same-site` n'en est pas : c'est un hôte voisin du même domaine
 * (`www.example.fr` pour `panel.example.fr`), que `SameSite=Lax` laisse
 * joindre le cookie et qui n'est pas le panel.
 */
const ACCEPTED_FETCH_SITES = new Set(["same-origin", "none"]);

/**
 * Hôte d'une origine (`https://panel.example.fr:443` → `panel.example.fr`).
 *
 * Sans port, comme l'hôte d'arrivée que Next transmet (`x-gd-host`) : un
 * développement en `:3000` doit se comparer à lui-même. `null` pour
 * l'origine opaque (`null`) et pour tout ce qui ne se lit pas comme une URL.
 */
export function hostOfOrigin(origin: string | null | undefined): string | null {
  if (!origin || origin === "null") return null;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "" ? null : host;
  } catch {
    return null;
  }
}

/**
 * Vrai quand le navigateur dit que la requête vient d'ailleurs que du panel.
 *
 * `panelHosts` : les hôtes qui **sont** le panel — celui de `PANEL_ORIGIN`
 * et celui par lequel la requête est arrivée (le domaine d'un revendeur sert
 * le même panel). Une entrée vide est ignorée, jamais prise pour un joker.
 */
export function foreignProvenance(
  provenance: BrowserProvenance,
  panelHosts: readonly (string | null | undefined)[],
): boolean {
  const site = provenance.fetchSite?.trim().toLowerCase();
  if (site && !ACCEPTED_FETCH_SITES.has(site)) return true;

  const origin = provenance.origin?.trim();
  if (!origin) return false;

  const host = hostOfOrigin(origin);
  if (host === null) return true;

  const accepted = panelHosts
    .map((entry) => entry?.trim().toLowerCase().replace(/:\d+$/, "") ?? "")
    .filter((entry) => entry !== "");
  return !accepted.includes(host);
}
