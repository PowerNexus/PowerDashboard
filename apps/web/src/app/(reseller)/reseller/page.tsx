import { ResellerOverview } from "@/components/reseller-overview";
import { pageTitle } from "@/lib/page-title";
import { fetchResellerOverview } from "@/server/api/reseller";

export const generateMetadata = pageTitle("reseller", "metaTitle");

export default async function ResellerPage() {
  return <ResellerOverview overview={await fetchResellerOverview()} />;
}
