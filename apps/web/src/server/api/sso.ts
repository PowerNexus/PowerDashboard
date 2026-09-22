import "server-only";
import { forwardedIdentityHeaders } from "./forwarded";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";
const PANEL_ORIGIN = process.env.PANEL_ORIGIN ?? "http://localhost:3000";

/**
 * Cookie qui porte l'état et le vérificateur PKCE pendant l'aller-retour.
 *
 * Chemin restreint à `/auth/sso` : il n'a aucune raison d'accompagner les
 * requêtes du reste du panel, et un secret qui voyage moins fuite moins.
 */
export const SSO_STATE_COOKIE = "gd_sso";
/** Défi de second facteur laissé par le retour SSO, lu par la page de connexion. */
export const SSO_CHALLENGE_COOKIE = "gd_sso_challenge";

export interface SsoPending {
  state: string;
  codeVerifier: string;
}

export interface SsoStatus {
  enabled: boolean;
  label: string | null;
}

/**
 * Adresse de retour, dérivée de l'origine du panel.
 *
 * Elle doit correspondre **exactement** à celle déclarée chez le fournisseur,
 * et elle est envoyée à l'identique aux deux étapes : la plupart des
 * fournisseurs comparent celle de `/authorize` et celle de `/token`, et
 * refusent l'échange à la moindre différence — un port, une barre oblique
 * finale suffisent.
 */
export function ssoRedirectUri(): string {
  return new URL("/auth/sso/callback", PANEL_ORIGIN).toString();
}

/** État de l'authentification unique, pour la page de connexion. */
export async function fetchSsoStatus(): Promise<SsoStatus> {
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/sso`, { cache: "no-store" });
    if (!response.ok) return { enabled: false, label: null };
    const { data } = (await response.json()) as { data: SsoStatus };
    return data;
  } catch {
    // L'API injoignable ne doit pas empêcher la page de connexion de s'afficher.
    // Sans réponse, on n'affirme pas que l'authentification unique est active :
    // ce serait retirer le formulaire sans offrir d'alternative.
    return { enabled: false, label: null };
  }
}

export async function startSso(): Promise<{
  url: string | null;
  pending: SsoPending | null;
  error: string | null;
}> {
  const response = await fetch(`${API_URL}/api/v1/auth/sso/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirectUri: ssoRedirectUri() }),
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) {
    return { url: null, pending: null, error: "Authentification unique indisponible." };
  }

  const { data } = (await response.json()) as {
    data: { url: string; state: string; codeVerifier: string };
  };
  return {
    url: data.url,
    pending: { state: data.state, codeVerifier: data.codeVerifier },
    error: null,
  };
}

/**
 * Termine la cérémonie côté API.
 *
 * Rend la réponse brute : l'appelant doit en recopier le cookie de session, et
 * distinguer une connexion aboutie d'une demande de second facteur.
 */
export async function completeSso(code: string, codeVerifier: string): Promise<Response> {
  return fetch(`${API_URL}/api/v1/auth/sso/callback`, {
    method: "POST",
    // Cette cérémonie ouvre une session : l'appareil qui apparaîtra dans la
    // liste doit être celui du visiteur, pas le serveur de rendu.
    headers: { "content-type": "application/json", ...(await forwardedIdentityHeaders()) },
    body: JSON.stringify({ code, codeVerifier, redirectUri: ssoRedirectUri() }),
    cache: "no-store",
  });
}
