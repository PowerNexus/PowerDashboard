import { ResellerNodes } from "@/components/reseller-nodes";
import { pageTitle } from "@/lib/page-title";
import { fetchResellerOverview } from "@/server/api/reseller";

export const generateMetadata = pageTitle("reseller", "nodesTitle");

export default async function ResellerNodesPage() {
  const { nodes } = await fetchResellerOverview();
  return <ResellerNodes nodes={nodes} />;
}
