import { AdminServers } from "@/components/admin-servers";
import { pageTitle } from "@/lib/page-title";
import { fetchAdminServers } from "@/server/api/admin";

export const generateMetadata = pageTitle("adminServers", "title");

export default async function AdminServersPage() {
  return <AdminServers initial={await fetchAdminServers()} />;
}
