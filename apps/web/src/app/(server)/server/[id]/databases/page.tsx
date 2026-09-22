import { DatabasesWorkspace } from "@/components/databases-workspace";
import { pageTitle } from "@/lib/page-title";
import { listDatabases } from "@/server/api/databases";

export const generateMetadata = pageTitle("databases", "title");

export default async function DatabasesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DatabasesWorkspace serverId={id} initial={await listDatabases(id)} />;
}
