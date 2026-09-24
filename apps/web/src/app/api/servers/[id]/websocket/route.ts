import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { forwardedIdentityHeaders } from "@/server/api/forwarded";
import { crossSiteRequest } from "@/server/browser-provenance";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";

/**
 * Demande une autorisation de websocket pour le compte du navigateur.
 *
 * Ce relais existe pour une raison précise : le navigateur ne doit pas
 * connaître l'adresse de l'API, ni pouvoir l'appeler directement. Il demande
 * ici, Next transmet le cookie de session, et l'API décide.
 *
 * Le jeton renvoyé, lui, est fait pour le navigateur : il ne vaut que pour ce
 * serveur, ne porte que ses permissions, et expire en dix minutes.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  /*
   * Contrôle d'origine explicite, en plus de `SameSite=Lax` sur le cookie.
   *
   * Ce relais n'est pas une action serveur de Next, il n'hérite donc pas de
   * sa vérification d'origine. Un site tiers ne doit pas pouvoir obtenir un
   * jeton de console au nom d'un visiteur connecté.
   *
   * La règle partagée avec l'API (NC-02). La comparaison d'avant, à
   * `PANEL_ORIGIN` seule, refusait la console ouverte depuis le domaine d'un
   * revendeur, et ne contrôlait plus rien quand la variable manquait.
   */
  if (crossSiteRequest(request)) {
    return NextResponse.json({ message: "Origine refusée." }, { status: 403 });
  }

  const [{ id }, store] = await Promise.all([params, cookies()]);
  const session = store.get(SESSION_COOKIE)?.value;

  if (!session) {
    return NextResponse.json({ message: "Session absente." }, { status: 401 });
  }

  const response = await fetch(`${API_URL}/api/v1/client/servers/${id}/websocket`, {
    method: "POST",
    // Transmis pour que l'API refasse le contrôle d'origine de son côté.
    headers: { ...(await forwardedIdentityHeaders()), cookie: `${SESSION_COOKIE}=${session}` },
    cache: "no-store",
  });

  // Le corps est transmis tel quel : il ne contient que le jeton et l'adresse,
  // tous deux destinés au navigateur.
  return NextResponse.json(await response.json().catch(() => ({})), {
    status: response.status,
  });
}
