import { ServerWebhooksWorkspace } from "@/components/server-webhooks-workspace";
import { pageTitle } from "@/lib/page-title";
import { listServerWebhooks } from "@/server/api/server-webhooks";

export const generateMetadata = pageTitle("serverWebhooks", "title");

export default async function ServerWebhooksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ServerWebhooksWorkspace serverId={id} initial={await listServerWebhooks(id)} />;
}
