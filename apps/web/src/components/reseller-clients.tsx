import {
  Avatar,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  formatMb,
  PageHeader,
  PageTemplate,
} from "@gamedashboard/ui";
import { Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type { ResellerClient } from "@/server/api/reseller";

/**
 * Clients du revendeur.
 *
 * Ce ne sont pas des comptes qu'il administre : ce sont les propriétaires des
 * serveurs qui tournent sur ses machines. Aucune table ne les lui rattache, et
 * il n'a aucune action sur eux — il voit qui consomme son matériel, et combien.
 *
 * Rien de ce qui relève de la vie du compte n'apparaît ici : ni rôle, ni
 * dernière connexion, ni double authentification. Ce sont les affaires de la
 * personne et de la plateforme, pas de son hébergeur intermédiaire.
 */
export async function ResellerClients({ clients }: { clients: ResellerClient[] }) {
  const t = await getTranslations("reseller");

  return (
    <PageTemplate
      header={<PageHeader icon={<Users />} title={t("clientsTitle")} subtitle={t("clientsHint")} />}
    >
      {clients.length === 0 ? (
        <EmptyState icon={<Users />} title={t("noClients")} description={t("noClientsHint")} />
      ) : (
        <Card>
          <CardHeader title={t("clientsTitle")} description={t("clientsTableHint")} />
          <CardBody className="divide-y divide-border px-0 py-0">
            {clients.map((client) => (
              <div key={client.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                <Avatar name={client.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-fg">{client.name}</p>
                  <p className="truncate text-xs text-muted">{client.email}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-fg">{t("clientServers", { count: client.servers })}</p>
                  <p className="gd-mono text-xs text-muted">{formatMb(client.memoryMb, 0)}</p>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </PageTemplate>
  );
}
