import { hasLiveMetrics, NODE_STATUS_TONE, nodeStatus } from "@gamedashboard/contracts";
import {
  AlertBanner,
  Badge,
  Button,
  formatMb,
  MetricBar,
  PageHeader,
  PageTemplate,
  StatTile,
  StatusDot,
} from "@gamedashboard/ui";
import { Activity, HardDrive, Server, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AdminRetention } from "@/components/admin-retention";
import { toNodeRow } from "@/lib/admin-view";
import { AutoRefresh } from "@/lib/use-auto-refresh";
import {
  fetchAdminNodes,
  fetchAdminServers,
  fetchAdminUsers,
  fetchRetention,
} from "@/server/api/admin";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminOverview");
  return { title: t("metaTitle") };
}

export default async function AdminOverviewPage() {
  const t = await getTranslations("adminOverview");
  const ts = await getTranslations("nodeStatus");
  // Les intitulés de capacité vivent avec l'écran des nodes : les dupliquer ici
  // les ferait diverger au premier ajustement.
  const tn = await getTranslations("adminNodes");
  const [rawNodes, adminServers, adminUsers, retention] = await Promise.all([
    fetchAdminNodes(),
    fetchAdminServers(),
    fetchAdminUsers(),
    fetchRetention(),
  ]);
  const allNodes = rawNodes.map(toNodeRow);
  const statuses = allNodes.map((n) => ({ node: n, status: nodeStatus(n) }));
  const down = statuses.filter((s) => s.status === "unreachable");
  const online = statuses.length - down.length;
  const totalServers = allNodes.reduce((s, n) => s + n.servers, 0);

  // La mémoire consommée n'est additionnée que sur les nodes effectivement
  // relevés : y mêler ceux qu'on n'a pas mesurés donnerait un taux faussement bas.
  const measurable = statuses.filter(
    (s) => hasLiveMetrics(s.status) && s.node.measuredMemoryMb !== null,
  );
  const memUsed = measurable.reduce((s, x) => s + (x.node.measuredMemoryMb ?? 0), 0);
  const memTotal = measurable.reduce((s, x) => s + x.node.memoryTotalMb, 0);
  const memPct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;

  return (
    <PageTemplate
      header={
        <PageHeader
          icon={<Activity />}
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <Button variant="secondary" asChild>
              <Link href="/admin/nodes">{t("viewNodes")}</Link>
            </Button>
          }
        />
      }
      toolbar={
        down.length > 0 ? (
          <AlertBanner variant="danger" title={t("downTitle", { count: down.length })}>
            {t("downBody", { nodes: down.map((s) => s.node.name).join(", ") })}
          </AlertBanner>
        ) : undefined
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={<HardDrive />}
          tone={down.length ? "danger" : "success"}
          label={t("nodes")}
          value={`${online} / ${allNodes.length}`}
          hint={t("nodesHint")}
        />
        <StatTile
          icon={<Server />}
          tone="accent"
          label={t("servers")}
          value={totalServers}
          hint={t("serversHint")}
        />
        <StatTile
          icon={<Users />}
          tone="default"
          label={t("users")}
          value={adminUsers.length}
          hint={t("usersHint")}
        />
        <StatTile
          icon={<Activity />}
          tone="warning"
          label={t("memoryUsed")}
          value={`${memPct} %`}
          hint={
            down.length
              ? t("memoryHintPartial", { used: formatMb(memUsed, 0), total: formatMb(memTotal, 0) })
              : t("memoryHint", { used: formatMb(memUsed, 0), total: formatMb(memTotal, 0) })
          }
        />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-fg">{t("capacity")}</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {statuses.map(({ node, status }) => {
            const live = hasLiveMetrics(status) ? node.measuredMemoryMb : null;
            return (
              <div
                key={node.id}
                className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5 shadow-card"
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <StatusDot
                    tone={NODE_STATUS_TONE[status]}
                    pulse={status === "maintenance" || status === "stale"}
                    label={ts(status)}
                  />
                  <Link href="/admin/nodes" className="font-semibold text-fg hover:text-accent">
                    {node.name}
                  </Link>
                  {status !== "online" ? (
                    <Badge variant={NODE_STATUS_TONE[status]}>{ts(status)}</Badge>
                  ) : null}
                  <span className="ml-auto text-xs text-muted">
                    {t("serversCount", { count: node.servers })}
                  </span>
                </div>
                {/* Pas de jauge processeur : Wings n'expose la charge d'une
                    machine par aucune route. Une jauge qui ne se remplit
                    jamais ferait chercher une panne là où il n'y a qu'une
                    information qui n'existe pas. */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <MetricBar
                    label={tn("allocatedMemory")}
                    value={node.allocatedMemoryMb}
                    max={node.memoryTotalMb}
                    format={(v) => formatMb(v, 0)}
                  />
                  <MetricBar
                    label={tn("allocatedDisk")}
                    value={node.allocatedDiskMb}
                    max={node.diskTotalMb}
                    format={(v) => formatMb(v, 0)}
                  />
                </div>
                {live !== null ? (
                  <p className="text-faint text-xs">
                    {tn("measuredUsage", {
                      used: formatMb(live, 0),
                      count: node.measuredServers,
                    })}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-fg">{t("latestServers")}</h2>
        <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card">
          {[...adminServers]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 4)
            .map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5 text-sm">
                <span className="font-semibold text-fg">{s.name}</span>
                <span className="gd-mono text-xs text-faint">{s.shortId}</span>
                <span className="text-muted">{s.owner}</span>
                <span className="ml-auto text-muted">{s.node}</span>
                <Badge variant={s.state === "installing" ? "info" : "neutral"}>{s.egg}</Badge>
              </div>
            ))}
        </div>
      </div>

      {/* L'état des nodes vieillit : sans ce rafraîchissement, la vue
          d'ensemble finit par déclarer injoignable un node qui bat. */}
      <AutoRefresh />

      {/* L'entretien de la base, en dernier : on ne l'ouvre pas tous les jours,
          mais quand on le cherche il doit être quelque part. */}
      <AdminRetention report={retention} />
    </PageTemplate>
  );
}
