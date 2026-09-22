import { ResellerServers } from "@/components/reseller-servers";
import { pageTitle } from "@/lib/page-title";
import { fetchResellerOverview } from "@/server/api/reseller";

export const generateMetadata = pageTitle("reseller", "serversTitle");

export default async function ResellerServersPage() {
  const { servers } = await fetchResellerOverview();
  return <ResellerServers servers={servers} />;
}
