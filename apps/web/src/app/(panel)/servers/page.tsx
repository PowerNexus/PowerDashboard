import { Button, EmptyState, PageHeader, PageTemplate } from "@gamedashboard/ui";
import { Plus, Server } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PendingInvitations } from "@/components/pending-invitations";
import { ServerGrid } from "@/components/server-grid";
import { pageTitle } from "@/lib/page-title";
import { toCardServer } from "@/lib/server-view";
import { AutoRefresh } from "@/lib/use-auto-refresh";
import { fetchFeatures, fetchMyServers } from "@/server/api/client";
import { fetchInvitations } from "@/server/api/subusers";

export const generateMetadata = pageTitle("serverList", "metaTitle");

/**
 * Données réelles, issues de l'API et de PostgreSQL.
 *
 * Les mesures d'exécution — processeur, mémoire, joueurs — ne figurent pas
 * encore : elles viennent de Wings par websocket (§7.3), pas de la base. Elles
 * sont donc transmises comme inconnues plutôt que comme zéro, ce que
 * `MetricBar` rend en hachures. Afficher zéro affirmerait que rien ne
 * consomme, ce qui est faux.
 */
export default async function ServersPage() {
  const [t, servers, features, invitations] = await Promise.all([
    getTranslations("serverList"),
    fetchMyServers(),
    fetchFeatures(),
    fetchInvitations(),
  ]);

  // Le bouton disparaît quand l'API refusera la création : proposer un
  // assistant qui ne peut que se terminer par un refus est pire que de ne rien
  // proposer.
  const create = features.serverCreation ? (
    <Button asChild>
      <Link href="/servers/new">
        <Plus /> {t("create")}
      </Link>
    </Button>
  ) : null;

  return (
    <PageTemplate
      header={
        <PageHeader
          icon={<Server />}
          title={t("title")}
          subtitle={t("subtitle")}
          actions={create}
        />
      }
      // Au-dessus de la liste : une invitation acceptée y ajoute un serveur, et
      // quelqu'un qui n'en a aucun doit la voir avant l'écran vide.
      toolbar={<PendingInvitations invitations={invitations} />}
    >
      {/* L'état d'un serveur vieillit : sans ce rafraîchissement, une page
          laissée ouverte montre « hors ligne » sur un serveur relancé depuis. */}
      <AutoRefresh />

      {servers.length === 0 ? (
        <EmptyState
          icon={<Server />}
          title={t("empty")}
          description={t("emptyHint")}
          action={create ?? undefined}
        />
      ) : (
        <ServerGrid servers={servers.map(toCardServer)} />
      )}
    </PageTemplate>
  );
}
