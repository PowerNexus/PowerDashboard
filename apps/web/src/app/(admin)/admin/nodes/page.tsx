import { AdminNodes, type ResellerOption } from "@/components/admin-nodes";
import { toNodeRow } from "@/lib/admin-view";
import { pageTitle } from "@/lib/page-title";
import {
  fetchAdminNodes,
  fetchAdminUsers,
  fetchLocations,
  fetchNodeTaxonomy,
} from "@/server/api/admin";

export const generateMetadata = pageTitle("adminNodes", "title");

export default async function AdminNodesPage() {
  // Le classement et les localisations viennent maintenant de la base et non
  // d'une constante : c'est ce qui rend les filtres, la création de node et la
  // gestion des catégories cohérents entre eux.
  const [nodes, users, taxonomy, locations] = await Promise.all([
    fetchAdminNodes(),
    fetchAdminUsers(),
    fetchNodeTaxonomy(),
    fetchLocations(),
  ]);

  /**
   * Seuls les comptes revendeurs peuvent exploiter un node.
   *
   * Le filtre est ici autant que dans l'API : proposer un client ordinaire
   * mènerait à un refus que rien n'annoncerait, alors que la raison est connue
   * d'avance.
   */
  const resellers: ResellerOption[] = users
    .filter((user) => user.role === "reseller")
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      platformAccess: user.platformAccess,
    }));

  return (
    <AdminNodes
      initial={nodes.map(toNodeRow)}
      resellers={resellers}
      taxonomy={taxonomy}
      // Lue sur le serveur, jamais reconstruite depuis le navigateur : la
      // commande affichée écrira cette adresse dans la configuration d'un
      // daemon, qui ira ensuite y chercher ses ordres.
      panelOrigin={process.env.PANEL_ORIGIN ?? "http://localhost:3000"}
      locations={locations}
    />
  );
}
