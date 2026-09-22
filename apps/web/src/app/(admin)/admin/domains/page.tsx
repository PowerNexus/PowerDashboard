import { ResellerDomainsWorkspace } from "@/components/reseller-domains-workspace";
import { pageTitle } from "@/lib/page-title";
import { fetchResellerDomains } from "@/server/api/reseller-domains";

export const generateMetadata = pageTitle("resellerDomains", "metaTitle");

export default async function ResellerDomainsPage() {
  return <ResellerDomainsWorkspace domains={await fetchResellerDomains()} />;
}
