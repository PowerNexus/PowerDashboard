import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * Relais d'un morceau vers l'API, **en flux**.
 *
 * Pourquoi un gestionnaire de route et non une action serveur, comme tout le
 * reste du panel : une action serveur sérialise son argument et plafonne son
 * corps à un mégaoctet. Un morceau en fait huit, et le faire passer par là
 * l'aurait tenu entier en mémoire avant même de l'examiner.
 *
 * Pourquoi un relais plutôt qu'un appel direct du navigateur à l'API : le
 * préfixe `/api/v1/client/` n'est pas exposé par le serveur web. C'est un
 * choix de déploiement — seules les routes applicatives et celles servies aux
 * nodes le sont —, et l'ouvrir pour un envoi de fichier reviendrait à publier
 * toute l'API cliente pour une fonctionnalité.
 *
 * Le corps n'est ni lu ni copié : il traverse tel quel.
 */
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string; uploadId: string; index: string }> },
): Promise<Response> {
  const { serverId, uploadId, index } = await params;

  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  // Sans session, inutile de déranger l'API : la réponse serait la même, une
  // requête plus tard.
  if (!session) return Response.json({ message: "Session absente." }, { status: 401 });

  const longueur = request.headers.get("content-length");
  if (!longueur) return Response.json({ message: "Longueur absente." }, { status: 411 });

  const reponse = await fetch(
    `${API_URL}/api/v1/client/servers/${encodeURIComponent(serverId)}/files/uploads/${encodeURIComponent(uploadId)}/${encodeURIComponent(index)}`,
    {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE}=${session}`,
        "content-type": "application/octet-stream",
        "content-length": longueur,
      },
      body: request.body,
      // Node exige cette mention dès qu'un corps est un flux : sans elle,
      // `fetch` refuse la requête avant de l'envoyer.
      duplex: "half",
    } as RequestInit & { duplex: "half" },
  );

  // Le refus de l'API est rendu tel quel : il nomme le morceau, sa taille
  // attendue ou la session expirée, et le remplacer par un échec générique
  // ferait recommencer un envoi de plusieurs gigaoctets sans savoir pourquoi.
  const corps = await reponse.text();
  return new Response(corps, {
    status: reponse.status,
    headers: { "content-type": reponse.headers.get("content-type") ?? "application/json" },
  });
}
