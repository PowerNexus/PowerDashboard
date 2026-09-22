import { ImageResponse } from "next/og";
import { getBranding } from "@/server/api/branding";

/**
 * Icône d'installation, dessinée à la demande.
 *
 * **Pourquoi la dessiner plutôt que servir le logo du revendeur ?** Parce
 * qu'un navigateur ne propose l'installation que s'il trouve une icône carrée
 * d'au moins 192 pixels, et qu'un logo déposé par un revendeur n'est ni carré
 * ni d'une taille connue. Le rediriger vers sa propre image reviendrait à
 * déclarer des dimensions qu'on ne contrôle pas : l'installation serait
 * refusée chez certains, sans que rien ne le dise.
 *
 * Le dessin est donc l'initiale de la marque sur sa couleur d'accent —
 * toujours carré, toujours à la bonne taille, et reconnaissable chez chaque
 * revendeur. C'est aussi ce qui satisfait le masque Android : la zone sûre est
 * le disque central, et un aplat couvrant avec une lettre au centre y survit
 * à tous les recadrages.
 */
const TAILLES = new Set([192, 512]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> },
): Promise<Response> {
  const { size } = await params;
  const cote = Number(size);
  // Une taille libre laisserait quiconque demander 8192 pixels en boucle : le
  // rendu est du travail réel, et deux tailles suffisent au manifeste.
  if (!TAILLES.has(cote)) return new Response("Taille non servie.", { status: 404 });

  const branding = await getBranding();
  const initiale = premiereLettre(branding.name);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: branding.accent,
        color: "#ffffff",
        // 56 % du côté : l'initiale reste dans le disque sûr du masque
        // Android, qui rogne jusqu'à 20 % de chaque bord.
        fontSize: cote * 0.56,
        fontWeight: 600,
        letterSpacing: "-0.04em",
      }}
    >
      {initiale}
    </div>,
    {
      width: cote,
      height: cote,
      headers: {
        // Une heure : le revendeur qui change son nom voit l'icône suivre sans
        // avoir à vider le cache de tous ses clients.
        "cache-control": "public, max-age=3600",
      },
    },
  );
}

/**
 * L'initiale à dessiner.
 *
 * Prise sur le premier caractère **de lettre ou de chiffre**, et non sur le
 * premier caractère tout court : un nom qui commence par une guillemet ou un
 * tiret donnerait une icône qui ne ressemble à rien.
 */
function premiereLettre(nom: string): string {
  const trouve = [...nom].find((caractere) => /\p{L}|\p{N}/u.test(caractere));
  return (trouve ?? "?").toUpperCase();
}
