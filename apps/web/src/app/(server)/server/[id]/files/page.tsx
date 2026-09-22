import { FilesWorkspace } from "@/components/files-workspace";
import { pageTitle } from "@/lib/page-title";

export const generateMetadata = pageTitle("files", "title");

export default async function FilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FilesWorkspace serverId={id} />;
}
