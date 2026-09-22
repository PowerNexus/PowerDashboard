import { AlertBanner, AuthCard, ThemeToggle } from "@gamedashboard/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RegisterForm } from "@/components/register-form";
import { pageTitle } from "@/lib/page-title";
import { getBranding } from "@/server/api/branding";
import { fetchPublicAuthConfig } from "@/server/api/register";

export const generateMetadata = pageTitle("register", "title");

/**
 * Inscription publique.
 *
 * La page existe même quand les inscriptions sont fermées, et le dit : le lien
 * « créer un compte » menait jusqu'ici à une page absente, ce qui laissait
 * penser à une panne du panel plutôt qu'à une décision de la plateforme.
 *
 * L'écran ne fait que cesser de proposer un chemin fermé ; c'est l'API qui
 * refuse, et elle refuserait aussi une requête postée directement.
 */
export default async function RegisterPage() {
  const [t, auth, branding] = await Promise.all([
    getTranslations("register"),
    fetchPublicAuthConfig(),
    getBranding(),
  ]);
  const open = auth.open;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
      <AuthCard
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={open ? t("description") : undefined}
        footer={
          <>
            {t("haveAccount")}{" "}
            <Link href="/login" className="font-semibold text-accent hover:underline">
              {t("signIn")}
            </Link>
            {/* Les conditions de celui chez qui on s'inscrit : sur le domaine
                d'un revendeur, c'est son contrat qui s'applique, pas celui de
                la plateforme. Rien ne s'affiche s'il n'en déclare aucun. */}
            {branding.termsUrl ? (
              <span className="mt-2 block text-xs">
                <a
                  href={branding.termsUrl}
                  className="text-muted hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("terms")}
                </a>
              </span>
            ) : null}
          </>
        }
      >
        {open ? (
          <RegisterForm captchaSiteKey={auth.captchaSiteKey} />
        ) : (
          <AlertBanner variant="info" title={t("closedTitle")}>
            {t("closedBody")}
          </AlertBanner>
        )}
      </AuthCard>
    </div>
  );
}
