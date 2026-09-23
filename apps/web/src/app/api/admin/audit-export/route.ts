import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { forwardedIdentityHeaders } from "@/server/api/forwarded";

/**
 * Relais de l'export du journal vers le navigateur, **en flux**.
 *
 * Le navigateur ne parle jamais à l'API d'administration : ses routes ne sont
 * pas exposées par le serveur web. Les lectures passent par le rendu serveur,
 * les écritures par des actions serveur — mais ni l'un ni l'autre ne sait
 * rendre un fichier à télécharger, et une action serveur tiendrait le fichier
 * entier en mémoire pour le sérialiser. D'où ce gestionnaire, comme pour
 * l'envoi de fichiers.
 *
 * Le corps traverse tel quel, morceau par morceau : un journal de plusieurs
 * centaines de mégaoctets ne passe pas plus par la mémoire de Next que par
 * celle de l'API.
 *
 * Les filtres sont transmis sans être relus ici : l'API les valide avec le
 * même schéma que la liste, et c'est elle qui fait foi. L'identité de
 * l'appelant (adresse, agent) suit, pour que la trace de l'export au journal
 * nomme le vrai poste et non `127.0.0.1`.
 */
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";

export async function GET(request: Request): Promise<Response> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return Response.json({ message: "Session absente." }, { status: 401 });

  const search = new URL(request.url).search;
  const upstream = await fetch(`${API_URL}/api/v1/admin/activity/export${search}`, {
    headers: {
      ...(await forwardedIdentityHeaders()),
      cookie: `${SESSION_COOKIE}=${session}`,
    },
    cache: "no-store",
    // Le navigateur abandonne le téléchargement : l'API cesse de lire la base.
    signal: request.signal,
  });

  if (!upstream.ok || !upstream.body) {
    // Le refus est rendu tel quel : « Cette action demande le rôle
    // administrateur » en dit plus qu'un échec générique.
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "content-disposition": upstream.headers.get("content-disposition") ?? "attachment",
      "cache-control": "no-store",
    },
  });
}
