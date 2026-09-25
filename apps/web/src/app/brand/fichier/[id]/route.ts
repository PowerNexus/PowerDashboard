import { relayBrandImage } from "@/server/brand-image";

/**
 * Logo ou favicon envoyé par fichier, sous le domaine d'arrivée.
 *
 * C'est l'adresse que les champs `logoUrl` et `faviconUrl` reçoivent après un
 * envoi ; `/brand/logo` et `/brand/favicon` y redirigent comme vers n'importe
 * quelle autre adresse de marque.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return relayBrandImage(id, request.headers.get("if-none-match"));
}
