import { DEFAULT_BRANDING } from "@gamedashboard/contracts";
import { getBranding } from "@/server/api/branding";
import { redirectToImage } from "../logo/route";

/**
 * Favicon de la marque servie.
 *
 * Séparé du logo parce qu'un revendeur peut vouloir un signe carré dans
 * l'onglet et un logo complet dans l'en-tête. Quand il n'en donne qu'un, c'est
 * la composition de la marque qui fait retomber l'un sur l'autre — pas cette
 * route, qui ne fait que servir le résultat.
 */
export async function GET(): Promise<Response> {
  const branding = await getBranding();
  return redirectToImage(branding.faviconUrl, DEFAULT_BRANDING.faviconUrl);
}
