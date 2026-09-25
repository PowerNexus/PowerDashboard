import "server-only";
import { getBranding } from "./branding";
import { currentHost, forwardedIdentityHeaders } from "./forwarded";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";
const PANEL_ORIGIN = process.env.PANEL_ORIGIN ?? "http://localhost:3000";

/**
 * Les deux cérémonies OAuth de la page de connexion.
 *
 * `sso` : l'annuaire de l'équipe, configurable, seul chemin une fois rendu
 * obligatoire. `google` : le bouton « Se connecter avec Google », une porte de
 * plus à côté du mot de passe (PLAN §12.4, décision 4). Même aller-retour,
 * mêmes protections ; chacune a ses routes — `/auth/<cérémonie>/…`, côté
 * interface comme côté API — et son cookie, pour qu'une cérémonie ouverte
 * chez l'un ne se termine jamais chez l'autre.
 */
export type Ceremony = "sso" | "google";

/**
 * Cookie qui porte l'état et le vérificateur PKCE pendant l'aller-retour.
 *
 * Chemin restreint à `/auth/<cérémonie>` : il n'a aucune raison d'accompagner
 * les requêtes du reste du panel, et un secret qui voyage moins fuite moins.
 */
export const CEREMONY_COOKIE: Record<Ceremony, string> = { sso: "gd_sso", google: "gd_google" };
/** Défi de second facteur laissé par le retour d'une cérémonie, lu par la page de connexion. */
export const SSO_CHALLENGE_COOKIE = "gd_sso_challenge";

export interface SsoPending {
  state: string;
  codeVerifier: string;
}

export interface SsoStatus {
  enabled: boolean;
  label: string | null;
}

export function ceremonyPath(ceremony: Ceremony): string {
  return `/auth/${ceremony}`;
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
export function ceremonyRedirectUri(ceremony: Ceremony, origin: string = PANEL_ORIGIN): string {
  return new URL(`${ceremonyPath(ceremony)}/callback`, origin).toString();
}

/**
 * Origine de la cérémonie : le domaine vérifié d'un revendeur quand on arrive
 * par lui, celle du panel sinon.
 *
 * Le retour doit revenir **là où la cérémonie est partie** : l'état et le
 * vérificateur PKCE vivent dans un cookie de ce domaine, et un retour sur le
 * domaine de la plateforme ne les trouverait pas — la cérémonie échouait
 * alors en « demande expirée ». La marque ne désigne un revendeur
 * (`resellerId`) que pour un domaine vérifié ; l'API refait ce contrôle.
 *
 * Chaque domaine doit figurer parmi les adresses de retour déclarées chez le
 * fournisseur (Google, l'annuaire), qui compare à l'identique.
 */
export async function ceremonyOrigin(): Promise<string> {
  const [host, branding] = await Promise.all([currentHost(), getBranding()]);
  return host !== null && branding.resellerId !== null ? `https://${host}` : PANEL_ORIGIN;
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

/**
 * Le bouton Google est-il proposé ?
 *
 * Faux quand l'API ne répond pas : un bouton qui mènerait à une erreur ne
 * vaut pas mieux que pas de bouton, et le mot de passe reste là.
 */
export async function fetchGoogleEnabled(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/google`, { cache: "no-store" });
    if (!response.ok) return false;
    const { data } = (await response.json()) as { data: { enabled: boolean } };
    return data.enabled === true;
  } catch {
    return false;
  }
}

export async function startCeremony(ceremony: Ceremony): Promise<{
  url: string | null;
  pending: SsoPending | null;
  error: string | null;
}> {
  const response = await fetch(`${API_URL}/api/v1/auth/${ceremony}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirectUri: ceremonyRedirectUri(ceremony, await ceremonyOrigin()) }),
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
export async function completeCeremony(
  ceremony: Ceremony,
  code: string,
  codeVerifier: string,
): Promise<Response> {
  return fetch(`${API_URL}/api/v1/auth/${ceremony}/callback`, {
    method: "POST",
    // Cette cérémonie ouvre une session : l'appareil qui apparaîtra dans la
    // liste doit être celui du visiteur, pas le serveur de rendu.
    headers: { "content-type": "application/json", ...(await forwardedIdentityHeaders()) },
    body: JSON.stringify({
      code,
      codeVerifier,
      redirectUri: ceremonyRedirectUri(ceremony, await ceremonyOrigin()),
    }),
    cache: "no-store",
  });
}
