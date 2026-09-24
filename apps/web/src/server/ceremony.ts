import "server-only";
import { LOCALE_COOKIE } from "@gamedashboard/i18n";
import { type NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE_OPTIONS,
  SECURE_COOKIES,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
} from "@/lib/session-cookie";
import {
  CEREMONY_COOKIE,
  type Ceremony,
  ceremonyPath,
  ceremonyRedirectUri,
  completeCeremony,
  SSO_CHALLENGE_COOKIE,
  type SsoPending,
  startCeremony,
} from "@/server/api/sso";

/**
 * Départ d'une cérémonie OAuth : l'annuaire (`/auth/sso/start`) ou Google
 * (`/auth/google/start`).
 *
 * Une route de navigation et non une action serveur : le navigateur doit
 * **partir** chez le fournisseur, ce qu'une action ne sait pas faire — elle
 * répond, elle ne redirige pas hors du site.
 *
 * L'état et le vérificateur PKCE sont déposés dans un cookie de la couche web,
 * seul endroit qui survive à l'aller-retour. Ils n'ont rien à faire côté API,
 * qui ne voit pas le navigateur, ni côté fournisseur.
 */
export async function beginCeremony(ceremony: Ceremony): Promise<NextResponse> {
  const started = await startCeremony(ceremony);
  if (started.error || !started.url || !started.pending) {
    // Réglage incomplet ou fournisseur injoignable : on repart sur la page de
    // connexion, qui dira ce qui manque, plutôt que d'afficher une page
    // d'erreur brute.
    return NextResponse.redirect(new URL("/login?sso=failed", ceremonyRedirectUri(ceremony)));
  }

  const response = NextResponse.redirect(started.url);
  response.cookies.set(CEREMONY_COOKIE[ceremony], JSON.stringify(started.pending), {
    path: ceremonyPath(ceremony),
    // Inaccessible au JavaScript de la page : le vérificateur PKCE ne protège
    // plus rien s'il peut être lu par un script injecté.
    httpOnly: true,
    // `lax` et non `strict` : le retour du fournisseur est une navigation
    // venue d'un autre site, et `strict` empêcherait le cookie de repartir.
    sameSite: "lax",
    secure: SECURE_COOKIES,
    // La cérémonie dure le temps de saisir des identifiants chez le
    // fournisseur. Au-delà, mieux vaut recommencer proprement.
    maxAge: 10 * 60,
  });
  return response;
}

/**
 * Retour du fournisseur.
 *
 * C'est ici, et nulle part ailleurs, que `state` est vérifié : la valeur
 * attendue vit dans un cookie que seule la couche web détient. L'API ne
 * saurait pas le faire — elle ne voit pas le navigateur.
 *
 * Sans cette vérification, n'importe qui pourrait faire suivre à une victime
 * un lien de retour portant **son** code d'autorisation, et la connecter au
 * compte de l'attaquant sans qu'elle s'en aperçoive.
 */
export async function finishCeremony(
  ceremony: Ceremony,
  request: NextRequest,
): Promise<NextResponse> {
  const origin = request.nextUrl.origin;
  /*
   * Toute sortie en échec efface la cérémonie, comme le succès.
   *
   * L'état passe dans l'URL d'autorisation, donc dans l'historique et les
   * journaux du fournisseur. Laissé dix minutes après un retour refusé, il
   * suffisait à qui l'avait appris pour faire terminer au navigateur une
   * cérémonie portant **son** code, et connecter la victime à son compte.
   * Une cérémonie refusée ne se reprend pas : on repart de la page de
   * connexion, qui en ouvre une neuve.
   */
  const fail = (reason: string) => {
    const refus = NextResponse.redirect(new URL(`/login?sso=${reason}`, origin));
    refus.cookies.delete({ name: CEREMONY_COOKIE[ceremony], path: ceremonyPath(ceremony) });
    return refus;
  };

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  // Le fournisseur signale ses propres refus par `error` : l'utilisateur a
  // cliqué « Annuler », ou l'application n'est pas autorisée. Le distinguer
  // d'un échec de notre côté évite de faire chercher une panne inexistante.
  if (request.nextUrl.searchParams.get("error")) return fail("denied");
  if (!code || !state) return fail("failed");

  const raw = request.cookies.get(CEREMONY_COOKIE[ceremony])?.value;
  if (!raw) return fail("expired");

  let pending: SsoPending;
  try {
    pending = JSON.parse(raw) as SsoPending;
  } catch {
    return fail("expired");
  }

  // Comparaison stricte de l'état. Une cérémonie dont l'état ne correspond pas
  // n'est pas celle qu'on a ouverte.
  if (typeof pending.state !== "string" || pending.state !== state) return fail("state");

  const response = await completeCeremony(ceremony, code, pending.codeVerifier).catch(() => null);
  if (!response?.ok) {
    // Google a reconnu la personne, mais aucun compte du panel ne porte son
    // adresse et les inscriptions sont fermées : le dire, plutôt qu'un refus
    // sans raison qui ferait réessayer en boucle.
    const refus = (await response?.json().catch(() => null)) as { noAccount?: boolean } | null;
    return fail(refus?.noAccount ? "noAccount" : "refused");
  }

  const conclusion = await concludeSignIn(origin, response);
  // La cérémonie est terminée : le vérificateur n'a plus rien à protéger et
  // ne doit pas resservir.
  conclusion.cookies.delete({ name: CEREMONY_COOKIE[ceremony], path: ceremonyPath(ceremony) });
  return conclusion;
}

/**
 * Fin commune des connexions attestées par un tiers : fournisseur OAuth, ou
 * facturier par son lien à usage unique.
 *
 * Toujours depuis une **route de navigation**, jamais depuis le rendu d'une
 * page : Next interdit d'y écrire un cookie. Le lien de la facturation le
 * faisait, et chaque arrivée sans second facteur finissait en erreur 500 —
 * jeton consommé et session ouverte côté API, jamais remise au navigateur.
 *
 * `response` est la réponse, réussie, de l'API.
 */
export async function concludeSignIn(origin: string, response: Response): Promise<NextResponse> {
  const body = (await response.json().catch(() => ({}))) as {
    twoFactorRequired?: boolean;
    challenge?: string;
    methods?: { totp: boolean; passkeys: boolean };
    remainingRecoveryCodes?: number;
    user?: { locale?: unknown };
  };

  /**
   * Le second facteur du panel s'applique aussi à ces chemins.
   *
   * Le défi repart vers la page de connexion, qui reprend la main sur la
   * seconde étape. Il ne donne accès à rien : il nomme seulement, sous
   * chiffrement, le compte dont la preuve est attendue.
   *
   * Les preuves disponibles voyagent avec lui. Elles ne sont pas secrètes — la
   * connexion par mot de passe les rend déjà en clair — et sans elles, l'écran
   * proposerait une clé d'accès à qui n'en a pas.
   */
  if (body.twoFactorRequired && body.challenge) {
    const destination = new URL("/login", origin);
    // Le défi voyage en cookie, pas dans l'URL : une adresse se retrouve dans
    // l'historique, les journaux du proxy et le Referer, un cookie non.
    if (body.methods?.totp) destination.searchParams.set("totp", "1");
    if (body.methods?.passkeys) destination.searchParams.set("passkeys", "1");
    destination.searchParams.set("recovery", String(body.remainingRecoveryCodes ?? 0));

    const redirect = NextResponse.redirect(destination);
    redirect.cookies.set(SSO_CHALLENGE_COOKIE, body.challenge, {
      path: "/login",
      httpOnly: true,
      sameSite: "lax",
      secure: SECURE_COOKIES,
      // Même durée que le défi lui-même.
      maxAge: 5 * 60,
    });
    return redirect;
  }

  const redirect = NextResponse.redirect(new URL("/", origin));
  const setCookie = response.headers.get("set-cookie");
  const token = setCookie?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (token) {
    redirect.cookies.set(SESSION_COOKIE, token, {
      ...AUTH_COOKIE_OPTIONS,
      maxAge: SESSION_MAX_AGE_S,
    });
  }

  // La langue du compte suit la connexion, comme après un mot de passe : le
  // rendu lit un cookie, pas la session.
  const locale = body.user?.locale;
  if (typeof locale === "string" && locale !== "") {
    redirect.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
      sameSite: "lax",
    });
  }
  return redirect;
}
