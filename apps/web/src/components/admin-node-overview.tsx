"use client";

import { hasLiveMetrics, nodeCapacityMb } from "@gamedashboard/contracts";
import {
  Card,
  CardBody,
  CardHeader,
  formatMb,
  KeyValueGrid,
  MetricBar,
  RelativeTime,
} from "@gamedashboard/ui";
import { useTranslations } from "next-intl";
import type { NodeRow } from "@/lib/admin-view";
import type { AdminNodeDetail } from "@/server/api/admin-node";
import { AdminNodeLoad } from "./admin-node-load";
import { nodeStatusAt } from "./node-status-line";

/**
 * Vue d'ensemble : la place qui reste, ce qu'est la machine, sa charge. L'état
 * lui-même est dit au-dessus des sections, sur toute la fiche.
 *
 * Deux chiffres de capacité, et il faut les deux. Ce qui est **promis** aux
 * serveurs est exact et dit s'il reste de la place ; ce qui est **consommé**
 * vient des relevés, peut manquer, et dit ce qui tourne vraiment. On vend des
 * limites, les clients en emploient une fraction : confondre les deux ferait
 * croire pleine une machine qui dort.
 */
export function AdminNodeOverview({
  detail,
  row,
  now,
}: {
  detail: AdminNodeDetail;
  row: NodeRow;
  now?: number;
}) {
  const t = useTranslations("nodeAdmin");
  const measured = hasLiveMetrics(nodeStatusAt(detail, now)) ? row.measuredMemoryMb : null;
  const memoryCap = nodeCapacityMb(detail.memoryMb, detail.memoryOverallocate);
  const diskCap = nodeCapacityMb(detail.diskMb, detail.diskOverallocate);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("overviewStatus")} />
          <CardBody className="flex flex-col gap-3">
            {detail.unreachableSince ? (
              <p className="text-danger-ink text-sm">
                {t("unreachableSince")} <RelativeTime value={detail.unreachableSince} />
              </p>
            ) : null}
            <KeyValueGrid
              items={[
                {
                  label: t("wingsVersion"),
                  value: detail.wingsVersion ?? t("wingsVersionUnknown"),
                },
                { label: t("columnServers"), value: String(detail.servers) },
                { label: t("columnOperator"), value: row.ownerName ?? t("operatorPlatform") },
                {
                  label: t("catalogue"),
                  value: detail.isPublic ? t("cataloguePublic") : t("cataloguePrivate"),
                },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("overviewCapacity")} description={t("capacityLegend")} />
          <CardBody className="flex flex-col gap-3">
            <MetricBar
              label={t("memoryPromised")}
              value={detail.memoryAllocatedMb}
              max={memoryCap}
              tone="auto"
              format={(v) => formatMb(v, 0)}
            />
            <MetricBar
              label={t("diskPromised")}
              value={detail.diskAllocatedMb}
              max={diskCap}
              tone="auto"
              format={(v) => formatMb(v, 0)}
            />
            {detail.memoryOverallocate > 0 || detail.diskOverallocate > 0 ? (
              <p className="text-muted text-xs">
                {t("overallocationNote", {
                  memory: detail.memoryOverallocate,
                  disk: detail.diskOverallocate,
                })}
              </p>
            ) : null}
            <p className="text-muted text-xs">
              {measured === null
                ? t("measuredNone")
                : t("measuredNow", { used: formatMb(measured, 0), count: row.measuredServers })}
            </p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t("overviewMachine")} />
        <CardBody>
          <KeyValueGrid
            items={[
              { label: t("location"), value: row.location },
              { label: t("fqdn"), value: <span className="gd-mono">{detail.fqdn}</span> },
              { label: t("protocol"), value: detail.scheme },
              {
                label: t("ports"),
                value: t("portsValue", { daemon: detail.daemonPort, sftp: detail.daemonSftpPort }),
              },
              { label: t("cpuCores"), value: String(detail.cpuCores) },
              { label: t("declared"), value: <RelativeTime value={detail.createdAt} /> },
            ]}
          />
        </CardBody>
      </Card>

      <AdminNodeLoad node={{ id: detail.id, name: detail.name }} />
    </div>
  );
}
