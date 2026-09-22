import { SubusersWorkspace } from "@/components/subusers-workspace";
import { pageTitle } from "@/lib/page-title";
import { listServerInvites, listSubusers } from "@/server/api/subusers";

export const generateMetadata = pageTitle("subusers", "title");

export default async function SubusersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Les deux lectures en parallèle : elles sont indépendantes, et les
  // enchaîner ajouterait un aller-retour à une page qu'on ouvre pour voir qui
  // a accès.
  const [subusers, invites] = await Promise.all([listSubusers(id), listServerInvites(id)]);
  return <SubusersWorkspace serverId={id} initial={subusers} invites={invites} />;
}
