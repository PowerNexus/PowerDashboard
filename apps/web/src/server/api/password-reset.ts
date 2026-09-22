"use server";

import { forwardedIdentityHeaders } from "./forwarded";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";

/**
 * Demande un lien de réinitialisation.
 *
 * **Rend toujours le même résultat**, que l'adresse existe ou non — l'API
 * répond d'ailleurs la même chose. Un écran qui distinguerait les deux cas
 * deviendrait un outil pour savoir qui est client, et cette information a de la
 * valeur pour qui prépare un hameçonnage.
 *
 * L'erreur réseau, elle, est dite : « nous n'avons pas pu demander » n'est pas
 * « nous avons demandé », et laisser quelqu'un attendre un courriel qui ne
 * partira jamais serait la pire des issues.
 */
export async function requestPasswordReset(
  email: string,
  captchaToken = "",
): Promise<{ error: string | null }> {
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/password/forgot`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await forwardedIdentityHeaders()) },
      body: JSON.stringify({ email, captchaToken }),
      cache: "no-store",
    });

    /*
     * Le refus du contrôle anti-automate est dit, lui.
     *
     * C'est la seule réponse 4xx de cette route qui concerne la personne devant
     * l'écran, et elle ne dit rien de l'adresse saisie : la taire ferait
     * attendre un courriel qui ne partira pas.
     */
    if (response.status === 403) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      return { error: body.message ?? "Le contrôle anti-automate n'a pas abouti." };
    }

    // 5xx seulement : un autre 4xx voudrait dire que la requête était malformée,
    // ce qui reste notre affaire et non celle de la personne devant l'écran.
    if (response.status >= 500) {
      return { error: "Le panel n'a pas pu traiter cette demande. Réessayez dans un instant." };
    }
    return { error: null };
  } catch {
    return { error: "Le panel est injoignable. Réessayez dans un instant." };
  }
}

/** Repose un mot de passe à partir du jeton reçu par courrier. */
export async function submitPasswordReset(
  token: string,
  password: string,
): Promise<{ error: string | null }> {
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/password/reset`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await forwardedIdentityHeaders()) },
      body: JSON.stringify({ token, password }),
      cache: "no-store",
    });

    if (response.ok) return { error: null };

    // Le message vient de l'API : c'est elle qui tient la politique de mot de
    // passe, et la recopier ici la ferait diverger au premier ajustement.
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    return { error: body.message ?? "Ce lien n'est plus valable." };
  } catch {
    return { error: "Le panel est injoignable. Réessayez dans un instant." };
  }
}
