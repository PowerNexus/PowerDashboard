import { SettingsWorkspace } from "@/components/settings-workspace";
import { pageTitle } from "@/lib/page-title";
import { fetchSettings } from "@/server/api/settings";

export const generateMetadata = pageTitle("serverSettings", "title");

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SettingsWorkspace serverId={id} initial={await fetchSettings(id)} />;
}
