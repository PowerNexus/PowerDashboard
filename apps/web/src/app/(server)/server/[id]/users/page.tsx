import { SubusersWorkspace } from "@/components/subusers-workspace";
import { pageTitle } from "@/lib/page-title";
import { listServerInvites, listSubuserPresets, listSubusers } from "@/server/api/subusers";

export const generateMetadata = pageTitle("subusers", "title");

export default async function SubusersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Les lectures en parallèle : elles sont indépendantes, et les enchaîner
  // ajouterait des allers-retours à une page qu'on ouvre pour voir qui a accès.
  const [subusers, invites, presets] = await Promise.all([
    listSubusers(id),
    listServerInvites(id),
    listSubuserPresets(id),
  ]);
  return <SubusersWorkspace serverId={id} initial={subusers} invites={invites} presets={presets} />;
}
