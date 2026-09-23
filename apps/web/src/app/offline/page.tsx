import { EmptyState } from "@gamedashboard/ui";
import { CloudOff } from "lucide-react";
import { connection } from "next/server";

/**
 * Ce que l'agent de service sert quand une navigation échoue.
 *
 * **Volontairement sans traduction ni appel réseau.** Elle est mise en cache à
 * l'installation de l'agent, c'est-à-dire une fois, dans une langue qui n'est
 * peut-être plus celle de la personne au moment où elle s'affiche ; et elle
 * doit se rendre alors que rien ne répond. Un texte court dans les deux
 * langues vaut mieux qu'un texte juste qu'on ne peut pas aller chercher.
 *
 * Pas de bouton « réessayer » non plus : il rechargerait la même page depuis
 * le cache. Le geste utile est celui du navigateur, qui refera la requête.
 */
export default async function OfflinePage() {
  /*
   * Rendue à la demande et non figée au build : une page figée n'a pas de
   * nonce, et ses scripts seraient refusés par la CSP. L'agent de service met
   * en cache la page **et** ses en-têtes : le nonce servi hors ligne est donc
   * toujours celui de la page.
   */
  await connection();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <EmptyState
        icon={<CloudOff />}
        title="Hors ligne"
        description="Cet écran a besoin du réseau et il ne répond pas. Rechargez la page une fois la connexion revenue. — This screen needs the network and it is not answering. Reload once you are back online."
      />
    </div>
  );
}
