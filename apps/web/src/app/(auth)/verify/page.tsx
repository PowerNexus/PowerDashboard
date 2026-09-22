import { AlertBanner, AuthCard, Button, ThemeToggle } from "@gamedashboard/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/page-title";
import { confirmEmail } from "@/server/api/email-verification";

export const generateMetadata = pageTitle("emailVerification", "title");

/**
 * Confirmation d'adresse.
 *
 * Le jeton est consommé **au chargement**, sans bouton à cliquer : on vient de
 * cliquer, dans son courriel, et redemander un second clic pour la même
 * intention n'apporte rien.
 *
 * Le risque connu de ce choix est qu'un aperçu automatique — certains
 * antivirus de messagerie ouvrent les liens — consomme le jeton à la place du
 * destinataire. C'est acceptable ici, et seulement ici : le lien n'ouvre aucun
 * accès et ne change aucun secret. Le lien de réinitialisation de mot de passe,
 * lui, ne fait rien tant qu'on n'a pas soumis le formulaire, précisément pour
 * cette raison.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("emailVerification");
  const parameters = await searchParams;
  const token = typeof parameters.token === "string" ? parameters.token : null;
  const result = token ? await confirmEmail(token) : { error: t("missingToken") };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
      <AuthCard eyebrow={t("eyebrow")} title={t("title")}>
        {result.error ? (
          <AlertBanner variant="danger" title={t("failedTitle")}>
            {result.error}
          </AlertBanner>
        ) : (
          <AlertBanner variant="success" title={t("doneTitle")}>
            {t("doneBody")}
          </AlertBanner>
        )}

        <Button className="mt-5" size="lg" fullWidth asChild>
          <Link href="/">{t("continue")}</Link>
        </Button>
      </AuthCard>
    </div>
  );
}
