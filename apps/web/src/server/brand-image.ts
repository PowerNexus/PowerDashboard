import { isBrandImageId } from "@gamedashboard/contracts";

/**
 * Relais des images de marque envoyées par fichier (`/brand/fichier/<id>`).
 *
 * L'image vit en base, derrière l'API ; l'interface la sert **sous le domaine
 * d'arrivée**, celui de la plateforme comme celui d'un revendeur, sans que
 * l'API soit exposée. Sur l'hébergement cPanel comme derrière nginx, c'est le
 * même chemin, servi par le même processus Next.
 */
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";

/** Au-delà, l'image manque plutôt que de retenir la page. */
const TIMEOUT_MS = 5_000;

/** Les seuls types que l'API range (`sniffBrandImage`). Jamais de SVG. */
const TYPES_SERVIS = new Set(["image/png", "image/jpeg", "image/webp", "image/x-icon"]);

/** En-têtes repris de l'API, et rien d'autre. */
const ENTETES_REPRIS = ["content-type", "etag", "cache-control", "content-security-policy"];

export async function relayBrandImage(id: string, ifNoneMatch: string | null): Promise<Response> {
  if (!isBrandImageId(id)) return refus(404);

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/branding/images/${id}`, {
      headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return refus(502);
  }

  return filtrerReponse(response);
}

/**
 * Ne laisse passer qu'une image d'un type admis, avec ses en-têtes de cache.
 *
 * Second contrôle, après celui de l'envoi : si une ligne de la base portait un
 * autre type — écrite à la main, ou par une version future moins stricte —,
 * elle ne serait pas servie sous le domaine du panel.
 */
export function filtrerReponse(response: Response): Response {
  if (response.status === 404) return refus(404);
  if (response.status !== 200 && response.status !== 304) return refus(502);

  const type = response.headers.get("content-type") ?? "";
  if (response.status === 200 && !TYPES_SERVIS.has(type)) return refus(502);

  const headers = new Headers({ "x-content-type-options": "nosniff" });
  for (const nom of ENTETES_REPRIS) {
    const valeur = response.headers.get(nom);
    if (valeur) headers.set(nom, valeur);
  }
  return new Response(response.status === 304 ? null : response.body, {
    status: response.status,
    headers,
  });
}

function refus(status: 404 | 502): Response {
  return new Response(status === 404 ? "Image introuvable." : "Image indisponible.", {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      // Un refus ne se garde pas : l'image peut être envoyée l'instant d'après.
      "cache-control": "no-store",
    },
  });
}
