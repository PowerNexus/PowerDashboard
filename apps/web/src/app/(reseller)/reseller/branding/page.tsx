import { ResellerBranding } from "@/components/reseller-branding";
import { pageTitle } from "@/lib/page-title";
import { fetchResellerBranding } from "@/server/api/reseller-branding";

export const generateMetadata = pageTitle("branding", "title");

export default async function ResellerBrandingPage() {
  return <ResellerBranding initial={await fetchResellerBranding()} />;
}
