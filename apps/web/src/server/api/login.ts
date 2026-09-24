"use server";

import { LOCALE_COOKIE } from "@gamedashboard/i18n";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { INITIAL_LOGIN_STATE, type LoginState } from "@/lib/login-state";
import { AUTH_COOKIE_OPTIONS, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/session-cookie";
import { forwardedIdentityHeaders } from "./forwarded";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";

/**
 * Où mène une connexion faite avec un mot de passe provisoire : le formulaire
 * de changement, avec l'avis qui dit pourquoi. Le mot de passe tiré par un
 * script d'exploitation expire, et l'y conduire tout de suite évite de le
 * découvrir le lendemain, porte fermée.
 */
const PROVISIONAL_PASSWORD_PAGE = "/account/security?password=provisional";

/** Destination après une session ouverte. */
function landing(body: { passwordChangeRequired?: boolean }): string {
  return body.passwordChangeRequired ? PROVISIONAL_PASSWORD_PAGE : "/";
}

/**
 * Connexion. Le mot de passe ne traverse que le serveur : le composant client
 * soumet un formulaire, il n'appelle pas l'API lui-même.
 */
export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const response = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await forwardedIdentityHeaders()) },
    body: JSON.stringify({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      // Posé par le widget Turnstile dans le formulaire. Absent quand la
      // plateforme n'exige aucun contrôle, auquel cas l'API ne le lit pas.
      captchaToken: String(formData.get("captchaToken") ?? ""),
    }),
  });

  if (!response.ok) {
    // Le message vient de l'API et ne distingue pas compte inexistant de mot de
    // passe faux : le formulaire ne doit pas devenir un outil d'énumération.
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    return {
      ...INITIAL_LOGIN_STATE,
      error: body.message ?? "Identifiants invalides.",
    };
  }

  const body = (await response.json().catch(() => ({}))) as {
    twoFactorRequired?: boolean;
    challenge?: string;
    methods?: { totp: boolean; passkeys: boolean };
    remainingRecoveryCodes?: number;
    user?: { locale?: unknown };
    passwordChangeRequired?: boolean;
  };

  /**
   * Le mot de passe est juste, mais l'API n'a posé aucun cookie.
   *
   * On rend la main au formulaire avec le défi, sans rien écrire : poser un
   * cookie ici, puis « demander » un code à l'écran, laisserait le compte
   * accessible à qui sait fermer une boîte de dialogue.
   */
  if (body.twoFactorRequired && body.challenge) {
    return {
      error: null,
      challenge: body.challenge,
      methods: body.methods ?? { totp: true, passkeys: false },
      remainingRecoveryCodes: body.remainingRecoveryCodes ?? 0,
    };
  }

  await adoptSession(response, body.user?.locale);
  redirect(landing(body));
}

/**
 * Second facteur.
 *
 * Le défi voyage par un champ caché du formulaire plutôt que par un cookie :
 * il ne vaut pas une session, et lui en donner les attributs inviterait à le
 * traiter comme telle.
 */
export async function submitSecondFactor(
  previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const challenge = String(formData.get("challenge") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  const recoveryCode = String(formData.get("recoveryCode") ?? "").trim();

  const response = await fetch(`${API_URL}/api/v1/auth/login/2fa`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await forwardedIdentityHeaders()) },
    // L'API refuse les deux à la fois ; l'écran n'en propose qu'un.
    body: JSON.stringify(recoveryCode ? { challenge, recoveryCode } : { challenge, code }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    return {
      ...previous,
      error: body.message ?? "Code invalide.",
    };
  }

  const body = await sessionBody(response);
  await adoptSession(response, body.user?.locale);
  redirect(landing(body));
}

/**
 * Options de la cérémonie WebAuthn, à partir du défi de connexion.
 *
 * Appelée impérativement par le composant client, et non comme action de
 * formulaire : la cérémonie se déroule dans le navigateur, entre cet appel et
 * le suivant.
 */
export async function passkeyLoginOptions(challenge: string): Promise<{
  options: unknown;
  challenge: string;
  error: string | null;
}> {
  const response = await fetch(`${API_URL}/api/v1/auth/login/2fa/passkey/options`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await forwardedIdentityHeaders()) },
    body: JSON.stringify({ challenge }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    return { options: null, challenge: "", error: body.message ?? "Demande expirée." };
  }

  const { data } = (await response.json()) as {
    data: { options: unknown; challenge: string };
  };
  return { ...data, error: null };
}

/** Vérifie l'assertion et ouvre la session. */
export async function submitPasskey(
  challenge: string,
  assertion: unknown,
): Promise<{ error: string | null }> {
  const response = await fetch(`${API_URL}/api/v1/auth/login/2fa/passkey`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await forwardedIdentityHeaders()) },
    body: JSON.stringify({ challenge, response: assertion }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    return { error: body.message ?? "Clé refusée." };
  }

  await adoptSession(response, await localeOf(response));
  redirect("/");
}

/**
 * Recopie le cookie posé par l'API sur la réponse de Next.
 *
 * L'API répond à Next, pas au navigateur : sans cette recopie, le cookie
 * s'arrêterait au serveur de rendu et la connexion n'aurait aucun effet visible.
 */
async function adoptSession(response: Response, locale?: unknown): Promise<void> {
  const setCookie = response.headers.get("set-cookie");
  const token = setCookie?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (!token) return;

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    ...AUTH_COOKIE_OPTIONS,
    maxAge: SESSION_MAX_AGE_S,
  });

  /*
   * La langue du compte suit la connexion.
   *
   * Le rendu côté serveur lit un cookie, pas la session : sans cette ligne,
   * quelqu'un qui a choisi le français retrouverait le panel dans la langue de
   * son navigateur à la première connexion depuis un nouvel appareil — alors
   * que sa préférence est bien enregistrée, et que rien à l'écran ne dirait
   * pourquoi elle n'est pas respectée.
   *
   * La langue est reçue en argument plutôt que relue ici : la réponse a déjà
   * été lue par l'appelant, et un corps de réponse ne se lit qu'une fois.
   */
  if (typeof locale === "string" && locale !== "") {
    store.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 365 * 24 * 60 * 60, sameSite: "lax" });
  }
}

/**
 * Langue du profil rendu par l'API, quand on peut encore la lire.
 *
 * Un corps de réponse ne se lit qu'une fois : sur les chemins où l'appelant
 * l'a déjà consommé, la lecture échoue et on rend `undefined`. C'est sans
 * conséquence — le compte garde sa préférence, seul le cookie attendra le
 * prochain changement de langue pour se mettre au diapason.
 */
async function localeOf(response: Response): Promise<unknown> {
  return (await sessionBody(response)).user?.locale;
}

/** Le corps d'une session ouverte, ou rien s'il a déjà été lu. */
async function sessionBody(
  response: Response,
): Promise<{ user?: { locale?: unknown }; passwordChangeRequired?: boolean }> {
  try {
    return (await response.json()) as {
      user?: { locale?: unknown };
      passwordChangeRequired?: boolean;
    };
  } catch {
    return {};
  }
}
