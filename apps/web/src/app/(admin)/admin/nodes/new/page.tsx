import { PageHeader, PageTemplate } from "@gamedashboard/ui";
import { HardDrive } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AdminNodeWizard } from "@/components/admin-node-wizard";
import type { ResellerOption } from "@/components/admin-nodes";
import { pageTitle } from "@/lib/page-title";
import { fetchAdminUsers, fetchLocations, fetchNodeTaxonomy } from "@/server/api/admin";

export const generateMetadata = pageTitle("nodeAdmin", "wizardTitle");

/**
 * Parcours « Ajouter une machine » : déclarer, installer Wings, attendre le
 * premier contact, terminé.
 */
export default async function AdminNodeNewPage() {
  const t = await getTranslations("nodeAdmin");
  const [users, taxonomy, locations] = await Promise.all([
    fetchAdminUsers(),
    fetchNodeTaxonomy(),
    fetchLocations(),
  ]);

  // Seuls les revendeurs peuvent exploiter une machine : l'API refuse les
  // autres, le choix ne les propose donc pas.
  const resellers: ResellerOption[] = users
    .filter((user) => user.role === "reseller")
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      platformAccess: user.platformAccess,
    }));

  return (
    <PageTemplate
      width="readable"
      header={
        <PageHeader
          icon={<HardDrive />}
          title={t("wizardTitle")}
          subtitle={t("wizardIntro")}
          breadcrumbs={[{ label: t("title"), href: "/admin/nodes" }, { label: t("wizardTitle") }]}
          LinkComponent={Link}
          breadcrumbsLabel={t("breadcrumbs")}
        />
      }
    >
      <AdminNodeWizard
        taxonomy={taxonomy}
        locations={locations}
        resellers={resellers}
        // Lue sur le serveur : la commande écrira cette adresse dans la
        // configuration du daemon, qui ira ensuite y chercher ses ordres.
        panelOrigin={process.env.PANEL_ORIGIN ?? "http://localhost:3000"}
      />
    </PageTemplate>
  );
}
