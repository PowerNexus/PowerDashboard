import { AdminServerDetailView } from "@/components/admin-server-detail";
import { pageTitle } from "@/lib/page-title";
import { fetchAdminEggs, fetchAdminNodes, fetchAdminUsers } from "@/server/api/admin";
import { fetchAdminServer } from "@/server/api/admin-server";

export const generateMetadata = pageTitle("adminServerDetail", "metaTitle");

/**
 * Fiche d'administration d'un serveur.
 *
 * Distincte de `/server/[id]`, qui est l'espace du **client** : celle-ci donne
 * des leviers qu'un propriétaire n'a pas — image de conteneur et commande de
 * démarrage libres — et les deux ne doivent pas se confondre.
 */
export default async function AdminServerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // La liste des nodes accompagne la fiche : le déplacement se décide ici, et
  // obliger à aller relever un identifiant ailleurs rendrait le choix aveugle.
  /*
   * Les comptes accompagnent la fiche, pour la même raison que les nodes :
   * changer de propriétaire en recopiant un identifiant relevé ailleurs
   * rendrait le choix aveugle — et un UUID mal collé désigne quelqu'un
   * d'autre sans que rien ne le dise.
   */
  /*
   * Le catalogue accompagne la fiche parce qu'on y change le jeu du serveur.
   * Les eggs désactivés sont écartés ici : l'API les refuse, et les proposer
   * ferait cliquer pour lire un refus.
   */
  const [server, nodes, comptes, catalogue] = await Promise.all([
    fetchAdminServer(id),
    fetchAdminNodes(),
    fetchAdminUsers(),
    fetchAdminEggs(),
  ]);

  return (
    <AdminServerDetailView
      server={server}
      nodes={nodes}
      eggs={catalogue
        .filter((egg) => egg.enabled)
        .map((egg) => ({ id: egg.id, name: egg.name, nest: egg.nest }))}
      owners={comptes.map((compte) => ({
        id: compte.id,
        name: compte.name,
        email: compte.email,
      }))}
    />
  );
}
