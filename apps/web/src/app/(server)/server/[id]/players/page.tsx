import { PlayersWorkspace } from "@/components/players-workspace";
import { pageTitle } from "@/lib/page-title";
import { getPlayers } from "@/server/api/players";

export const generateMetadata = pageTitle("players", "title");

export default async function PlayersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlayersWorkspace serverId={id} view={await getPlayers(id)} />;
}
