import { AlertBanner, AuthCard, ThemeToggle } from "@gamedashboard/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "@/components/password-reset-forms";
import { pageTitle } from "@/lib/page-title";
import { getBranding } from "@/server/api/branding";
import { fetchPublicAuthConfig } from "@/server/api/register";

export const generateMetadata = pageTitle("passwordReset", "forgotTitle");

/**
 * « Mot de passe oublié ».
 *
 * Servie même quand l'authentification unique est active : un compte créé avant
 * sa mise en place garde un mot de passe local, et l'API répond de toute façon
 * la même chose à toutes les adresses. Masquer la page ne protégerait rien et
 * enfermerait ces comptes-là dehors.
 */
export default async function ForgotPasswordPage() {
  const [t, auth, branding] = await Promise.all([
    getTranslations("passwordReset"),
    fetchPublicAuthConfig(),
    getBranding(),
  ]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
      <AuthCard
        eyebrow={t("eyebrow")}
        title={t("forgotTitle")}
        // Sans courrier, la promesse d'envoi disparaît avec le formulaire :
        // la laisser au-dessus du bandeau ferait se contredire deux phrases
        // à trois lignes d'écart.
        description={auth.passwordResetByEmail ? t("forgotDescription") : undefined}
        footer={
          <Link href="/login" className="font-semibold text-accent hover:underline">
            {t("backToLogin")}
          </Link>
        }
      >
        {/*
          Sans courrier, on le dit — on ne présente pas le formulaire.
          L'écran de connexion cesse déjà de proposer le lien ; cette page
          reste atteignable par un signet, et quelqu'un qui arrive ici est
          justement celui qu'un remerciement poli laisserait attendre un
          message qui ne partira pas.
        */}
        {auth.passwordResetByEmail ? (
          <ForgotPasswordForm captchaSiteKey={auth.captchaSiteKey} />
        ) : (
          <AlertBanner variant="warning" title={t("unavailableTitle")}>
            <p>{t("unavailableBody")}</p>
            {branding.supportUrl ? (
              <p className="mt-3">
                <a
                  href={branding.supportUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold hover:underline"
                >
                  {t("unavailableContact")}
                </a>
              </p>
            ) : null}
          </AlertBanner>
        )}
      </AuthCard>
    </div>
  );
}
