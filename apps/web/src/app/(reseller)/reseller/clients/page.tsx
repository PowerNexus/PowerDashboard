import { ResellerClients } from "@/components/reseller-clients";
import { pageTitle } from "@/lib/page-title";
import { fetchResellerOverview } from "@/server/api/reseller";

export const generateMetadata = pageTitle("reseller", "clientsTitle");

export default async function ResellerClientsPage() {
  const { clients } = await fetchResellerOverview();
  return <ResellerClients clients={clients} />;
}
