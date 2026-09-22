import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";
const PANEL_ORIGIN = process.env.PANEL_ORIGIN ?? null;

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
   */
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") {
    return NextResponse.json({ message: "Origine refusée." }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin !== null && PANEL_ORIGIN !== null && origin !== PANEL_ORIGIN) {
    return NextResponse.json({ message: "Origine refusée." }, { status: 403 });
  }

  const [{ id }, store] = await Promise.all([params, cookies()]);
  const session = store.get(SESSION_COOKIE)?.value;

  if (!session) {
    return NextResponse.json({ message: "Session absente." }, { status: 401 });
  }

  const response = await fetch(`${API_URL}/api/v1/client/servers/${id}/websocket`, {
    method: "POST",
    headers: { cookie: `${SESSION_COOKIE}=${session}` },
    cache: "no-store",
  });

  // Le corps est transmis tel quel : il ne contient que le jeton et l'adresse,
  // tous deux destinés au navigateur.
  return NextResponse.json(await response.json().catch(() => ({})), {
    status: response.status,
  });
}
