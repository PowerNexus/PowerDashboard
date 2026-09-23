import { AlertBanner, AuthCard, Button, ThemeToggle } from "@gamedashboard/ui";
import { LogIn } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { GoogleSignIn } from "@/components/google-sign-in";
import { LoginForm } from "@/components/login-form";
import { pageTitle } from "@/lib/page-title";
import { getBranding } from "@/server/api/branding";
import { fetchPublicAuthConfig } from "@/server/api/register";
import { fetchGoogleEnabled, fetchSsoStatus, SSO_CHALLENGE_COOKIE } from "@/server/api/sso";

export const generateMetadata = pageTitle("login", "title");

/** Raisons d'échec renvoyées par les routes de cérémonie, dans l'URL. */
const SSO_FAILURES = new Set(["failed", "denied", "expired", "state", "refused", "noAccount"]);

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("login");
  const parameters = await searchParams;
  const [sso, auth, branding, google] = await Promise.all([
    fetchSsoStatus(),
    fetchPublicAuthConfig(),
    getBranding(),
    fetchGoogleEnabled(),
  ]);
  const registrationOpen = auth.open;

  /**
   * Un système de facturation tient-il les comptes clients ?
   *
   * Décide du visage de la page. `clientUrl` n'est pas exigée pour le savoir :
   * un exploitant peut avoir choisi son facturier sans avoir encore renseigné
   * l'adresse de l'espace client, et la page doit déjà cesser de se présenter
   * comme le chemin des clients — elle se contente alors de ne pas proposer de
   * lien.
   */
  const billingActive = auth.billing.provider !== "" && auth.billing.provider !== "none";

  const failure = typeof parameters.sso === "string" ? parameters.sso : null;
  // Le défi revient du retour SSO quand le compte exige un second facteur : la
  // cérémonie externe a réussi, il reste une preuve à apporter ici. Il est
  // dans un cookie court, jamais dans l'URL.
  const challenge = (await cookies()).get(SSO_CHALLENGE_COOKIE)?.value ?? null;

  /**
   * Reprise d'une cérémonie externe qui attend encore un second facteur.
   *
   * `null` dans le cas courant : le formulaire part alors de la saisie des
   * identifiants, comme sur un panel sans authentification unique.
   */
  const resumed = challenge
    ? {
        error: null,
        challenge,
        methods: {
          totp: parameters.totp === "1",
          passkeys: parameters.passkeys === "1",
        },
        remainingRecoveryCodes: Number(parameters.recovery ?? 0) || 0,
      }
    : null;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <AuthCard
        // La phrase du revendeur prend la place du sur-titre quand il en pose
        // une : c'est la ligne qui doit rassurer son client, et la laisser sous
        // le générique « Espace client » reviendrait à ne jamais l'afficher.
        eyebrow={branding.loginTagline ?? t("eyebrow")}
        title={t("title")}
        /*
         * Ce que dit la page dépend de qui doit s'y trouver.
         *
         * Avec un système de facturation en service, **le client n'a pas de
         * mot de passe ici** : il entre par un lien fabriqué depuis son espace
         * client. Cette page devient celle de l'équipe et des personnes
         * invitées sur un serveur, et le dire évite qu'un client s'épuise sur
         * des identifiants qui n'existent pas — puis écrive au support.
         */
        description={
          sso.enabled && !challenge
            ? t("ssoDescription")
            : billingActive
              ? t("staffDescription")
              : t("description")
        }
        footer={
          // Trois raisons de ne rien proposer, et une seule suffit : sans mot
          // de passe local, le compte se crée chez le fournisseur à la première
          // connexion ; inscriptions fermées, le lien menait à une porte close ;
          // et avec un facturier, un client ne se crée pas un compte ici — il
          // en obtient un en commandant.
          sso.enabled || billingActive || !registrationOpen ? null : (
            <>
              {t("noAccount")}{" "}
              <Link href="/register" className="font-semibold text-accent hover:underline">
                {t("createAccount")}
              </Link>
            </>
          )
        }
      >
        {failure && SSO_FAILURES.has(failure) ? (
          <AlertBanner variant="danger" title={t("refused")}>
            {t(`ssoError.${failure}`)}
          </AlertBanner>
        ) : null}

        {/*
          La porte des clients, montrée en premier.

          C'est le cas le plus fréquent de quelqu'un qui atterrit ici par
          erreur : un client qui cherche son serveur. Sans ce bloc, il essaie
          son mot de passe de facturation, échoue, demande une
          réinitialisation pour un compte qui n'en a pas, et finit par écrire.
          Le placer avant le formulaire coûte quelques lignes et supprime tout
          ce parcours.

          Le lien manque quand l'adresse de l'espace client n'est pas
          renseignée : on dit alors où aller sans prétendre savoir où c'est.
        */}
        {billingActive && !challenge ? (
          <div className="mb-5 rounded-lg border border-border bg-surface-2 px-4 py-3">
            <p className="font-semibold text-sm">{t("clientsTitle")}</p>
            <p className="mt-1 text-muted text-xs">{t("clientsBody")}</p>
            {auth.billing.clientUrl ? (
              <Button className="mt-3" size="sm" fullWidth variant="secondary" asChild>
                <a href={auth.billing.clientUrl}>{t("clientsCta")}</a>
              </Button>
            ) : null}
          </div>
        ) : null}

        {/*
          Quand l'authentification unique est obligatoire, le formulaire de mot
          de passe n'est pas seulement caché : l'API le refuse aussi. L'écran
          ne fait que cesser de proposer un chemin qui n'existe plus.

          Le second facteur, lui, reste servi par le formulaire : la cérémonie
          externe a nommé le compte, il reste à prouver la possession.
        */}
        {sso.enabled && !challenge ? (
          <Button size="lg" fullWidth asChild>
            <a href="/auth/sso/start">
              <LogIn /> {t("ssoSignIn", { provider: sso.label ?? "" })}
            </a>
          </Button>
        ) : (
          <LoginForm
            resumed={resumed}
            captchaSiteKey={auth.captchaSiteKey}
            passwordResetByEmail={auth.passwordResetByEmail}
            alternative={
              google ? (
                <GoogleSignIn
                  label={t("ssoSignIn", { provider: "Google" })}
                  separator={t("orWithEmail")}
                />
              ) : null
            }
          />
        )}
      </AuthCard>

      {/* La mention du revendeur, sous la carte : sa raison sociale, quand il
          en déclare une. Le panel n'en invente pas. */}
      {branding.footerText ? (
        <p className="absolute bottom-6 text-muted text-xs">{branding.footerText}</p>
      ) : null}
    </div>
  );
}
