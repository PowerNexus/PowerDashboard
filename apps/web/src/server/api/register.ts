"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE_OPTIONS, SESSION_COOKIE } from "@/lib/session-cookie";
import { forwardedIdentityHeaders } from "./forwarded";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";

/**
 * Ce que les écrans publics doivent savoir avant de se rendre.
 *
 * Les deux voyagent ensemble parce que les mêmes pages les lisent au même
 * moment : une seconde route ferait un second aller-retour pour deux champs.
 */
export interface PublicAuthConfig {
  open: boolean;
  /** Clé de site Turnstile, ou `null` quand aucun contrôle n'est exigé. */
  captchaSiteKey: string | null;
  /**
   * La réinitialisation par courrier aboutit-elle ?
   *
   * Faux quand la plateforme n'a pas de SMTP. Les écrans cessent alors de
   * proposer « mot de passe oublié » — un parcours qui remercie poliment sans
   * rien envoyer est pire que pas de parcours du tout.
   */
  passwordResetByEmail: boolean;
  /**
   * Par où entrent les clients.
   *
   * `provider` vaut `"none"` quand aucun système de facturation n'est réglé :
   * la page de connexion est alors le chemin de tout le monde. Sinon, les
   * clients n'ont pas de mot de passe ici — ils arrivent par un lien fabriqué
   * depuis leur espace client — et la page doit les y renvoyer plutôt que de
   * leur présenter un formulaire où ils s'épuiseront.
   */
  billing: { provider: string; clientUrl: string | null };
}

/**
 * Ce qu'on sert quand l'API ne répond pas : **rien n'est proposé**.
 *
 * On n'affirme pas que les inscriptions sont fermées ni que le courrier est en
 * panne — on cesse simplement d'offrir des chemins qu'on ne peut pas garantir.
 * Proposer l'un des deux au jugé mènerait à un écran qui échoue à l'étape
 * suivante, ce qui est plus déroutant qu'un lien absent.
 */
const UNAVAILABLE: PublicAuthConfig = {
  open: false,
  captchaSiteKey: null,
  passwordResetByEmail: false,
  // Même prudence : sans réponse de l'API, on ne renvoie personne vers un
  // espace client dont on ignore l'adresse.
  billing: { provider: "none", clientUrl: null },
};

export async function fetchPublicAuthConfig(): Promise<PublicAuthConfig> {
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/registration`, { cache: "no-store" });
    if (!response.ok) return UNAVAILABLE;
    const { data } = (await response.json()) as { data: PublicAuthConfig };
    return data;
  } catch {
    // L'API injoignable ne doit pas faire croire que les inscriptions sont
    // ouvertes : on n'affirme rien, on cesse de proposer. Et pas de captcha
    // inventé — l'API refuserait de toute façon la requête suivante.
    return UNAVAILABLE;
  }
}

/** L'inscription est-elle ouverte ? Lu par la page de connexion et par /register. */
export async function fetchRegistrationOpen(): Promise<boolean> {
  return (await fetchPublicAuthConfig()).open;
}

/**
 * Crée un compte, puis ouvre la session.
 *
 * Le mot de passe ne traverse que le serveur, comme à la connexion : le
 * composant client soumet un formulaire, il n'appelle pas l'API lui-même.
 */
export async function register(
  _previous: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const response = await fetch(`${API_URL}/api/v1/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await forwardedIdentityHeaders()) },
    body: JSON.stringify({
      email: String(formData.get("email") ?? ""),
      nameFirst: String(formData.get("nameFirst") ?? ""),
      nameLast: String(formData.get("nameLast") ?? ""),
      password: String(formData.get("password") ?? ""),
      captchaToken: String(formData.get("captchaToken") ?? ""),
    }),
  }).catch(() => null);

  if (!response) return { error: "Le panel est injoignable. Réessayez dans un instant." };

  if (!response.ok) {
    // Le message vient de l'API : c'est elle qui tient la politique de mot de
    // passe, et la recopier ici la ferait diverger au premier ajustement.
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    return { error: body.message ?? "Inscription refusée." };
  }

  const body = (await response.json().catch(() => ({}))) as { user?: { locale?: unknown } };
  const setCookie = response.headers.get("set-cookie");
  const token = setCookie?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];

  if (token) {
    const store = await cookies();
    store.set(SESSION_COOKIE, token, {
      ...AUTH_COOKIE_OPTIONS,
      maxAge: 7 * 24 * 60 * 60,
    });
  }

  void body;
  redirect("/");
}
