import { MarketplaceWorkspace } from "@/components/marketplace-workspace";
import { pageTitle } from "@/lib/page-title";
import { fetchCatalogue } from "@/server/api/marketplace";

export const generateMetadata = pageTitle("marketplace", "title");

/**
 * La recherche interroge Modrinth **depuis le serveur**.
 *
 * Le navigateur ne parle jamais au catalogue : c'est ce qui permet à l'API de
 * choisir seule l'adresse qu'elle remettra au daemon.
 */
export default async function MarketplacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const query = search.q ?? "";

  return (
    <MarketplaceWorkspace serverId={id} query={query} initial={await fetchCatalogue(id, query)} />
  );
}
