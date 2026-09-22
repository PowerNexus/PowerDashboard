import { AdminEggs } from "@/components/admin-eggs";
import { pageTitle } from "@/lib/page-title";
import { fetchAdminEggs, fetchEggCatalogue } from "@/server/api/admin";

export const generateMetadata = pageTitle("adminEggs", "title");

export default async function AdminEggsPage() {
  // Les deux lectures partent ensemble : le catalogue local et ce que le dépôt
  // propose s'affichent sur le même écran, et les enchaîner ajouterait leurs
  // latences — dont un aller-retour vers GitHub.
  const [eggs, catalogue] = await Promise.all([fetchAdminEggs(), fetchEggCatalogue()]);

  return <AdminEggs initial={eggs} source={catalogue.source} entries={catalogue.entries} />;
}
