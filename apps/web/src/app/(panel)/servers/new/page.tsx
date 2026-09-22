import { choosesOwner, platformMayProvision } from "@gamedashboard/contracts";
import { CreateServerWizard, type OwnerOption } from "@/components/create-server-wizard";
import { pageTitle } from "@/lib/page-title";
import { fetchAdminUsers } from "@/server/api/admin";
import { fetchCreationCatalogue } from "@/server/api/catalogue";
import { fetchMe } from "@/server/api/client";
import { fetchResellerOverview } from "@/server/api/reseller";

export const generateMetadata = pageTitle("createServer", "title");

export default async function NewServerPage() {
  const [catalogue, me] = await Promise.all([fetchCreationCatalogue(), fetchMe()]);

  /**
   * La liste des comptes n'est chargée que pour le mode avancé.
   *
   * La demander toujours ferait échouer la page pour tout le monde : la route
   * est réservée aux administrateurs, et elle répond 404 aux autres. Le mode
   * vient de l'API, pas du rôle lu ici — une seule source décide.
   */
  /*
   * À qui ce serveur peut être destiné.
   *
   * Deux listes, parce que deux personnes différentes posent la question :
   *
   * - l'**administrateur** choisit dans l'annuaire de la plateforme ;
   * - le **revendeur** choisit parmi **ses** clients — ceux qui possèdent déjà
   *   un serveur qu'il héberge. Lui montrer l'annuaire lui apprendrait qui
   *   sont les clients de ses confrères, et l'API refuserait de toute façon
   *   d'en servir un.
   *
   * Un revendeur ne voit donc pas ici le compte tout neuf qu'il vient de
   * créer : il n'a encore aucun serveur, donc il n'est à personne. C'est la
   * limite de cette liste, et elle est du bon côté — l'API, elle, accepterait.
   */
  const owners: OwnerOption[] = !choosesOwner(catalogue.mode)
    ? []
    : me.role === "reseller"
      ? (await fetchResellerOverview()).clients.map((client) => ({
          id: client.id,
          name: client.name,
          email: client.email,
          role: "user",
          provisionable: true,
        }))
      : (await fetchAdminUsers()).map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          // Un revendeur qui n'a rien autorisé n'est pas provisionnable. L'API
          // refuse de toute façon ; l'écran cesse simplement de le proposer.
          provisionable: user.role !== "reseller" || platformMayProvision(user.platformAccess),
        }));

  return <CreateServerWizard catalogue={catalogue} owners={owners} selfId={me.id} />;
}
