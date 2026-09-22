import { AdminSettings } from "@/components/admin-settings";
import { pageTitle } from "@/lib/page-title";
import { fetchPlatformSettings } from "@/server/api/admin";

export const generateMetadata = pageTitle("adminSettings", "title");

export default async function AdminSettingsPage() {
  return <AdminSettings initial={await fetchPlatformSettings()} />;
}
