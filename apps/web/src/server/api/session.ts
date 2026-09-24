"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE_OPTIONS, RETURN_COOKIE, SESSION_COOKIE } from "@/lib/session-cookie";
import { apiSend } from "./client";
import { forwardedIdentityHeaders } from "./forwarded";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";

/**
 * Déconnexion.
 *
 * Deux gestes, et les deux comptent. L'API révoque la session en base — sans
 * quoi le cookie resterait valable pour qui l'aurait recopié — et le cookie est
 * effacé ici, côté navigateur. N'en faire qu'un laisserait soit une session
 * vivante sans porteur, soit un porteur sans session qui verrait des 401
 * jusqu'à ce qu'il pense à vider son cache.
 *
 * L'échec de l'appel n'empêche pas l'effacement : quelqu'un qui demande à
 * partir doit partir, même si l'API ne répond pas. La session expirera d'elle-
 * même, et rester connecté de force serait le pire des deux maux.
 */
export async function signOut(): Promise<never> {
  await apiSend("/api/v1/auth/logout", {}).catch(() => undefined);

  const store = await cookies();
  // Avec ses attributs : un effacement sans `Secure` est ignoré pour un nom en
  // `__Host-`, et le cookie révoqué restait dans le navigateur.
  store.delete({ name: SESSION_COOKIE, ...AUTH_COOKIE_OPTIONS });

  redirect("/login");
}

/**
 * Prend en main le compte d'un client, en lecture seule.
 *
 * **Les cookies sont recopiés à la main**, et c'est le cœur de cette fonction.
 * Le navigateur ne parle jamais à l'API : c'est Next qui l'appelle, et le
 * `Set-Cookie` de la réponse s'arrête donc au serveur. Sans cette recopie, la
 * session serait ouverte en base et personne ne la porterait.
 */
export async function impersonate(userId: string): Promise<{ error: string | null }> {
  return relayCookies(`/api/v1/admin/users/${userId}/impersonate`, "Prise en main refusée.");
}

/** Rend la main et rouvre la session du membre du personnel. */
export async function stopImpersonation(): Promise<{ error: string | null }> {
  return relayCookies("/api/v1/auth/impersonation/stop", "Retour impossible.");
}

/**
 * Appelle l'API et reporte ses cookies dans le navigateur.
 *
 * Seuls les deux cookies de ce mécanisme sont recopiés, nommément : relayer
 * tout ce que l'API renvoie ferait de cette fonction un tuyau par lequel
 * n'importe quel en-tête futur atteindrait le navigateur sans qu'on l'ait
 * décidé.
 */
async function relayCookies(path: string, fallback: string): Promise<{ error: string | null }> {
  const store = await cookies();

  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(await forwardedIdentityHeaders()),
        ...(store.get(SESSION_COOKIE) ? { cookie: serializeCookies(store.getAll()) } : {}),
      },
      body: "{}",
      cache: "no-store",
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      return { error: body.message ?? fallback };
    }

    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const [name, ...rest] = (pair ?? "").split("=");
      if (name !== SESSION_COOKIE && name !== RETURN_COOKIE) continue;

      const value = decodeURIComponent(rest.join("="));
      // Une valeur vide est un effacement : l'API vide le cookie de retour
      // quand la prise en main se termine. Mêmes protections que le cookie
      // posé à la connexion, effacement compris (`AUTH_COOKIE_OPTIONS`).
      if (value === "") store.delete({ name, ...AUTH_COOKIE_OPTIONS });
      else store.set(name, value, AUTH_COOKIE_OPTIONS);
    }

    return { error: null };
  } catch {
    return { error: fallback };
  }
}

function serializeCookies(all: { name: string; value: string }[]): string {
  return all.map((c) => `${c.name}=${encodeURIComponent(c.value)}`).join("; ");
}
