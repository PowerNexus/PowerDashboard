import { AdminUsers } from "@/components/admin-users";
import { pageTitle } from "@/lib/page-title";
import { fetchAdminUsers } from "@/server/api/admin";

export const generateMetadata = pageTitle("adminUsers", "title");

export default async function AdminUsersPage() {
  return <AdminUsers initial={await fetchAdminUsers()} />;
}
