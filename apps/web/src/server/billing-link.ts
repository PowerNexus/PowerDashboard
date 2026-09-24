import "server-only";
import { type NextRequest, NextResponse } from "next/server";
import { forwardedIdentityHeaders } from "@/server/api/forwarded";
import { concludeSignIn } from "@/server/ceremony";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";

/** Raisons d'un refus, reprises par la page `/sso` pour choisir son texte. */
type BillingLinkFailure = "expired" | "suspended" | "failed";

/**
 * L'arrivée d'un client depuis son espace de facturation.
 *
 * Le client n'a pas de mot de passe sur ce panel : il a cliqué « Gérer mon
 * serveur », et le plugin l'a redirigé ici avec un jeton valable deux minutes
 * et une seule fois. Le jeton est consommé **à l'arrivée**, sans bouton : lui
 * redemander de confirmer qu'il veut entrer chez lui n'apporterait rien, et ce
 * lien ne voyage pas dans une boîte de réception où un aperçu le grillerait.
 *
 * Une route de navigation, pas une page : il faut poser le cookie de session,
 * ce qu'un rendu de page n'a pas le droit de faire. C'était une page, et
 * chaque arrivée sans second facteur finissait en erreur 500.
 *
 * Le second facteur du compte, que le lien ne remplace pas (NC-05), se passe
 * sur la page de connexion, comme au retour d'un fournisseur d'identité.
 */
export async function arriveByBillingLink(
  request: NextRequest,
  token: string,
): Promise<NextResponse> {
  const origin = request.nextUrl.origin;
  const refuse = (reason: BillingLinkFailure) =>
    NextResponse.redirect(new URL(`/sso?refus=${reason}`, origin));

  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1/auth/billing/consume`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await forwardedIdentityHeaders()) },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });
  } catch {
    return refuse("failed");
  }

  // L'API ne distingue pas le jeton inconnu, expiré ou déjà employé : la page
  // non plus. Seule la suspension du compte se dit, parce qu'un nouveau lien
  // n'y changerait rien.
  if (response.status === 401) return refuse("expired");
  if (response.status === 403) return refuse("suspended");
  if (!response.ok) return refuse("failed");

  return concludeSignIn(origin, response);
}
