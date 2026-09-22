import { AccountWorkspace } from "@/components/account-workspace";
import { pageTitle } from "@/lib/page-title";
import { fetchMe } from "@/server/api/client";
import { fetchNotificationPreferences } from "@/server/api/notification-preferences";

export const generateMetadata = pageTitle("account", "title");

export default async function AccountPage() {
  // Les deux lectures sont indépendantes : les enchaîner ferait attendre la
  // page deux fois pour rien.
  const [user, notifications] = await Promise.all([fetchMe(), fetchNotificationPreferences()]);

  return <AccountWorkspace user={user} notifications={notifications} />;
}
