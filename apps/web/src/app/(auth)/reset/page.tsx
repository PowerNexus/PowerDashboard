import { AlertBanner, AuthCard, ThemeToggle } from "@gamedashboard/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ResetPasswordForm } from "@/components/password-reset-forms";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("passwordReset", "resetTitle");

/**
 * Choix d'un nouveau mot de passe, à partir du jeton reçu par courrier.
 *
 * Le jeton n'est **pas vérifié à l'affichage**, et c'est délibéré : le faire
 * obligerait à le consommer — un jeton à usage unique ne se teste pas sans
 * l'user — ou à ouvrir une route qui dit si un jeton est valable, ce qui
 * permettrait d'en éprouver au hasard. La page accueille donc, et c'est l'envoi
 * qui tranche.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("passwordReset");
  const parameters = await searchParams;
  const token = typeof parameters.token === "string" ? parameters.token : null;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
      <AuthCard
        eyebrow={t("eyebrow")}
        title={t("resetTitle")}
        description={t("resetDescription")}
        footer={
          <Link href="/login" className="font-semibold text-accent hover:underline">
            {t("backToLogin")}
          </Link>
        }
      >
        {/* Sans jeton dans l'adresse, le formulaire n'a rien à envoyer : mieux
            vaut le dire que présenter des champs voués au refus. */}
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <AlertBanner variant="warning" title={t("missingTokenTitle")}>
            {t("missingTokenBody")}
          </AlertBanner>
        )}
      </AuthCard>
    </div>
  );
}
