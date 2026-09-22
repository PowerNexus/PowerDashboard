import { ResellerSettings } from "@/components/reseller-settings";
import { pageTitle } from "@/lib/page-title";
import { fetchResellerOverview } from "@/server/api/reseller";

export const generateMetadata = pageTitle("reseller", "settingsTitle");

export default async function ResellerSettingsPage() {
  const { platformAccess } = await fetchResellerOverview();
  return <ResellerSettings level={platformAccess} />;
}
