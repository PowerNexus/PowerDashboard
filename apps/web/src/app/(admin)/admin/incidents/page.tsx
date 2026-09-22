import { AdminIncidents } from "@/components/admin-incidents";
import { pageTitle } from "@/lib/page-title";
import { fetchAdminNodes } from "@/server/api/admin";
import { fetchIncidents } from "@/server/api/incidents";

export const generateMetadata = pageTitle("adminIncidents", "title");

export default async function AdminIncidentsPage() {
  // Les nodes servent à désigner les composants touchés. Ils sont lus ici
  // plutôt que dans le composant : la liste ne change pas pendant la rédaction,
  // et une lecture côté client rendrait le formulaire dépendant du réseau au
  // pire moment.
  const [incidents, nodes] = await Promise.all([fetchIncidents(), fetchAdminNodes()]);

  return (
    <AdminIncidents
      initial={incidents}
      components={nodes
        // Un node de revendeur n'apparaît pas sur la page publique : le
        // proposer ici laisserait désigner un composant que personne ne verra.
        .filter((node) => node.ownerId === null)
        .map((node) => ({ id: node.id, name: node.name }))}
    />
  );
}
