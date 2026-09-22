import { ApiKeysWorkspace } from "@/components/api-keys-workspace";
import { pageTitle } from "@/lib/page-title";
import { listApiKeys } from "@/server/api/api-keys";

export const generateMetadata = pageTitle("apiKeys", "title");

export default async function ApiKeysPage() {
  return <ApiKeysWorkspace initial={await listApiKeys()} />;
}
