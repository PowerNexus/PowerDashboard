import { DatabaseHostsWorkspace } from "@/components/database-hosts-workspace";
import { pageTitle } from "@/lib/page-title";
import { fetchAdminNodes } from "@/server/api/admin";
import { fetchDatabaseHosts } from "@/server/api/database-hosts";

export const generateMetadata = pageTitle("databaseHosts", "metaTitle");

/**
 * Hôtes MySQL de la plateforme.
 *
 * Les nodes accompagnent la liste : un hôte peut être réservé à l'un d'eux,
 * quand la base tourne sur la même machine que les serveurs de jeu, et choisir
 * un identifiant sans voir les noms serait aveugle.
 */
export default async function DatabaseHostsPage() {
  const [hosts, nodes] = await Promise.all([fetchDatabaseHosts(), fetchAdminNodes()]);
  return <DatabaseHostsWorkspace hosts={hosts} nodes={nodes} />;
}
