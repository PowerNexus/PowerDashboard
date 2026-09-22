import { NetworkWorkspace } from "@/components/network-workspace";
import { pageTitle } from "@/lib/page-title";
import { listAllocations } from "@/server/api/network";

export const generateMetadata = pageTitle("network", "title");

export default async function NetworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NetworkWorkspace serverId={id} initial={await listAllocations(id)} />;
}
