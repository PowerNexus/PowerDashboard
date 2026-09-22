import { ActivityWorkspace } from "@/components/activity-workspace";
import { pageTitle } from "@/lib/page-title";
import { fetchActivity } from "@/server/api/activity";

export const generateMetadata = pageTitle("activity", "title");

/**
 * La recherche et la page viennent de l'URL, et la lecture se fait côté
 * serveur : le journal peut compter des centaines de milliers de lignes, dont
 * le navigateur n'a aucune raison de recevoir plus d'une page.
 */
export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const [{ id }, search] = await Promise.all([params, searchParams]);

  return (
    <ActivityWorkspace
      serverId={id}
      initial={
        await fetchActivity(id, {
          query: search.q,
          page: Number.parseInt(search.page ?? "1", 10) || 1,
        })
      }
    />
  );
}
