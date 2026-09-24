import { AlertBanner, AuthCard, Button, ThemeToggle } from "@gamedashboard/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/login-form";
import { pageTitle } from "@/lib/page-title";
import { consumeBillingLink } from "@/server/api/login";

export const generateMetadata = pageTitle("billingSso", "title");

/**
 * L'arrivée d'un client depuis son espace de facturation.
 *
 * Le jeton est consommé **au chargement**, sans bouton : le client vient
 * précisément de cliquer « Gérer mon serveur », et lui redemander de confirmer
 * qu'il veut bien entrer chez lui n'apporterait rien.
 *
 * Le risque d'un aperçu automatique — celui qui a fait choisir un clic
 * explicite pour les invitations — ne se pose pas ici : ce lien ne voyage pas
 * dans une boîte de réception. Il vit deux minutes, entre une redirection et
 * l'arrivée du navigateur.
 *
 * En cas de succès, on ne s'arrête pas sur cette page : `redirect` emmène
 * aussitôt à l'accueil du panel. Ce qu'on voit ici est donc un échec — lien
 * expiré, déjà employé, ou recopié à la main — ou le second facteur du compte,
 * que le lien ne remplace pas (NC-05).
 */
export default async function BillingSsoPage({ params }: { params: Promise<{ token: string }> }) {
  const t = await getTranslations("billingSso");
  const { token } = await params;
  const { error, secondFactor } = await consumeBillingLink(token);

  // Hors du bloc d'erreur, et non dans un `try` : Next implémente `redirect`
  // en levant une exception qu'il intercepte lui-même.
  if (!error && !secondFactor) redirect("/");

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
      <AuthCard
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={secondFactor ? t("secondFactor") : undefined}
      >
        {/* Le formulaire de connexion reprend à la seconde étape, comme au
            retour d'un fournisseur d'identité : le compte est nommé, il reste
            à prouver la possession de la clé. */}
        {secondFactor ? (
          <LoginForm resumed={secondFactor} />
        ) : (
          <>
            <AlertBanner variant="danger" title={t("failedTitle")}>
              {error}
            </AlertBanner>
            {/* Le geste utile n'est pas de réessayer ce lien — il est mort —
                mais de repartir de l'espace client, qui en fabriquera un autre. */}
            <p className="mt-4 text-muted text-sm">{t("retryHint")}</p>
            <Button className="mt-5" size="lg" fullWidth variant="secondary" asChild>
              <Link href="/login">{t("staffSignIn")}</Link>
            </Button>
          </>
        )}
      </AuthCard>
    </div>
  );
}
