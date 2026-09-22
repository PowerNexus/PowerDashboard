import { BackupsWorkspace } from "@/components/backups-workspace";
import { pageTitle } from "@/lib/page-title";
import { listBackups } from "@/server/api/backups";

export const generateMetadata = pageTitle("backups", "title");

export default async function BackupsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BackupsWorkspace serverId={id} initial={await listBackups(id)} />;
}
