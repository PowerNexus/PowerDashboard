import { AdminSettings } from "@/components/admin-settings";
import { AdminSubuserPresets } from "@/components/admin-subuser-presets";
import { pageTitle } from "@/lib/page-title";
import { CONFIGURATION_ROLES } from "@/lib/roles";
import { fetchPlatformSettings, fetchSubuserPresets } from "@/server/api/admin";
import { fetchMe } from "@/server/api/client";

export const generateMetadata = pageTitle("adminSettings", "title");

export default async function AdminSettingsPage() {
  const [settings, presets, me] = await Promise.all([
    fetchPlatformSettings(),
    fetchSubuserPresets(),
    fetchMe(),
  ]);

  return (
    <AdminSettings initial={settings}>
      <AdminSubuserPresets initial={presets} canEdit={CONFIGURATION_ROLES.has(me.role)} />
    </AdminSettings>
  );
}
