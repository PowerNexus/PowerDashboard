import { type NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy, newNonce } from "@/lib/content-security-policy";

/**
 * Pose la CSP à nonce de chaque page (voir `lib/content-security-policy.ts`).
 *
 * Le nonce doit être neuf à chaque requête : c'est pourquoi la politique vit
 * ici et non dans les en-têtes fixes de `next.config.ts`. Il part dans deux
 * directions :
 * - dans l'en-tête **de la requête**, où Next le lit pour le poser sur ses
 *   scripts pendant le rendu, et `x-nonce` pour les rares balises écrites à
 *   la main (`/gd-theme.js`, dans la mise en page racine) ;
 * - dans l'en-tête **de la réponse**, que le navigateur applique.
 */
export function proxy(request: NextRequest) {
  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === "production");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      /*
       * Les pages seulement. Les fichiers compilés, les images et les routes
       * `api/` ne sont pas du HTML : une CSP n'y protège rien, et tirer un
       * nonce pour chacun ne coûterait que du temps.
       */
      source: "/((?!api|_next/static|_next/image|brand|sw.js|gd-theme.js|manifest.webmanifest).*)",
      // Les préchargements de `next/link` ne rendent pas de page affichée.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
