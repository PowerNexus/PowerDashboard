import { NextResponse } from "next/server";
import { SSO_STATE_COOKIE, ssoRedirectUri, startSso } from "@/server/api/sso";

/**
 * Départ de la cérémonie d'authentification unique.
 *
 * Une route de navigation et non une action serveur : le navigateur doit
 * **partir** chez le fournisseur, ce qu'une action ne sait pas faire — elle
 * répond, elle ne redirige pas hors du site.
 *
 * L'état et le vérificateur PKCE sont déposés dans un cookie de la couche web,
 * seul endroit qui survive à l'aller-retour. Ils n'ont rien à faire côté API,
 * qui ne voit pas le navigateur, ni côté fournisseur.
 */
export async function GET(): Promise<NextResponse> {
  const started = await startSso();
  if (started.error || !started.url || !started.pending) {
    // Réglage incomplet ou fournisseur injoignable : on repart sur la page de
    // connexion, qui dira ce qui manque, plutôt que d'afficher une page
    // d'erreur brute.
    return NextResponse.redirect(new URL("/login?sso=failed", ssoRedirectUri()));
  }

  const response = NextResponse.redirect(started.url);
  response.cookies.set(SSO_STATE_COOKIE, JSON.stringify(started.pending), {
    path: "/auth/sso",
    // Inaccessible au JavaScript de la page : le vérificateur PKCE ne protège
    // plus rien s'il peut être lu par un script injecté.
    httpOnly: true,
    // `lax` et non `strict` : le retour du fournisseur est une navigation
    // venue d'un autre site, et `strict` empêcherait le cookie de repartir.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // La cérémonie dure le temps de saisir des identifiants chez le
    // fournisseur. Au-delà, mieux vaut recommencer proprement.
    maxAge: 10 * 60,
  });
  return response;
}

/** Jamais mise en cache : chaque départ tire un état et un vérificateur neufs. */
export const dynamic = "force-dynamic";
