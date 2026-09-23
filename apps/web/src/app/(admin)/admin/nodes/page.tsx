import { AdminNodes } from "@/components/admin-nodes";
import { toNodeRow } from "@/lib/admin-view";
import { pageTitle } from "@/lib/page-title";
import { fetchAdminNodes, fetchLocations, fetchNodeTaxonomy } from "@/server/api/admin";

export const generateMetadata = pageTitle("adminNodes", "title");

/**
 * La liste des machines.
 *
 * Elle ne charge plus les comptes ni l'origine du panel : l'attribution à un
 * revendeur et l'installation du daemon vivent sur la fiche de chaque machine,
 * qui les charge elle-même.
 */
export default async function AdminNodesPage() {
  const [nodes, taxonomy, locations] = await Promise.all([
    fetchAdminNodes(),
    fetchNodeTaxonomy(),
    fetchLocations(),
  ]);

  return <AdminNodes initial={nodes.map(toNodeRow)} taxonomy={taxonomy} locations={locations} />;
}
