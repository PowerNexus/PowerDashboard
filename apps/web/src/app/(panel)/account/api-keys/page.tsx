import { ApiKeysWorkspace } from "@/components/api-keys-workspace";
import { pageTitle } from "@/lib/page-title";
import { listApiKeys } from "@/server/api/api-keys";
import { fetchTwoFactorStatus } from "@/server/api/two-factor";

export const generateMetadata = pageTitle("apiKeys", "title");

export default async function ApiKeysPage() {
  // L'état du second facteur dit si le compte a un mot de passe à redonner
  // avant de créer une clé. Les deux lectures sont indépendantes.
  const [keys, twoFactor] = await Promise.all([listApiKeys(), fetchTwoFactorStatus()]);
  return <ApiKeysWorkspace initial={keys} localPassword={twoFactor.localPassword} />;
}
