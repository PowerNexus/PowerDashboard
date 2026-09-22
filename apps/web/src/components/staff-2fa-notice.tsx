import { Button, EmptyState, PageHeader, PageTemplate } from "@gamedashboard/ui";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * Ce que voit un membre du personnel sans seconde preuve.
 *
 * **L'API refuse déjà** — c'est elle qui fait règle, et ce composant ne
 * protège rien. Il transforme un refus en explication, et mène là où on peut
 * le lever : sans lui, l'espace d'administration s'afficherait en erreur, sans
 * dire quoi faire.
 *
 * Aucune redirection automatique vers la page de sécurité : une redirection
 * sans phrase laisse croire à un bogue de navigation. On dit d'abord pourquoi,
 * on propose ensuite.
 */
export async function StaffTwoFactorNotice() {
  const t = await getTranslations("staffTwoFactor");

  return (
    <PageTemplate
      width="narrow"
      header={<PageHeader icon={<ShieldAlert />} title={t("title")} subtitle={t("body")} />}
    >
      <EmptyState
        icon={<ShieldAlert />}
        title={t("emptyTitle")}
        description={t("emptyBody")}
        action={
          <Button asChild>
            <Link href="/account/security">{t("action")}</Link>
          </Button>
        }
      />
    </PageTemplate>
  );
}
