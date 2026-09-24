import { AlertBanner, AuthCard, Button, ThemeToggle } from "@gamedashboard/ui";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("billingSso", "title");

/**
 * Un lien de la facturation refusé.
 *
 * La route `/sso/[jeton]` consomme le lien et, quand tout va bien, emmène
 * aussitôt au panel : on n'arrive ici qu'après un refus. La raison vient de
 * l'URL, mais elle ne choisit qu'un texte du catalogue — jamais une phrase
 * recopiée, qu'un lien fabriqué ferait dire au panel.
 */
export default async function BillingSsoRefusedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("billingSso");
  const { refus } = await searchParams;

  const [title, message] =
    refus === "suspended"
      ? [t("suspendedTitle"), t("suspended")]
      : refus === "failed"
        ? [t("unavailableTitle"), t("unavailable")]
        : [t("failedTitle"), t("expired")];

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
      <AuthCard eyebrow={t("eyebrow")} title={t("title")}>
        <AlertBanner variant="danger" title={title}>
          {message}
        </AlertBanner>
        {/* Le geste utile n'est pas de réessayer ce lien — il est mort — mais
            de repartir de l'espace client, qui en fabriquera un autre. */}
        {refus === "suspended" ? null : <p className="mt-4 text-muted text-sm">{t("retryHint")}</p>}
        <Button className="mt-5" size="lg" fullWidth variant="secondary" asChild>
          <Link href="/login">{t("staffSignIn")}</Link>
        </Button>
      </AuthCard>
    </div>
  );
}
