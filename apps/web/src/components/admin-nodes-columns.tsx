"use client";

import { hasLiveMetrics, isOutdated } from "@gamedashboard/contracts";
import {
  Badge,
  type ColumnDef,
  DropdownItem,
  DropdownSeparator,
  formatMb,
  MetricBar,
  RowActions,
} from "@gamedashboard/ui";
import { ArrowUpCircle, FileText, Network, Power } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { NodeRow } from "@/lib/admin-view";
import { NodeStatusLine, nodeStatusAt } from "./node-status-line";

/**
 * Les colonnes de la liste des machines.
 *
 * **Trois actions seulement au menu d'une ligne** : ouvrir la fiche, gérer les
 * ports, basculer la maintenance — les gestes qu'on fait souvent depuis la
 * liste. Tout le reste (réglages, jeton, installation, revendeurs, suppression)
 * vit sur la fiche, rangé par section, où chaque geste a la place d'expliquer
 * ce qu'il provoque. Un menu de douze entrées ne le permettait pas.
 */
export function useNodeColumns(input: {
  now: number | null;
  latest: string | null;
  pending: boolean;
  onToggleMaintenance: (node: NodeRow) => void;
  /** Ouvre la fiche, éventuellement sur une section donnée. */
  onOpen: (node: NodeRow, section?: string) => void;
}): ColumnDef<NodeRow, unknown>[] {
  const t = useTranslations("nodeAdmin");
  const { now, latest, pending, onToggleMaintenance, onOpen } = input;

  return useMemo<ColumnDef<NodeRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columnMachine"),
        cell: ({ row }) => (
          <div className="min-w-0">
            {/* Un vrai lien, et pas seulement la ligne cliquable : il se
                parcourt au clavier et s'ouvre dans un nouvel onglet. */}
            <Link
              href={`/admin/nodes/${row.original.id}`}
              className="font-semibold text-fg hover:text-accent"
            >
              {row.original.name}
            </Link>
            <p className="gd-mono text-muted text-xs">{row.original.fqdn}</p>
            <p className="text-faint text-xs">{row.original.location}</p>
          </div>
        ),
      },
      {
        id: "status",
        header: t("columnStatus"),
        accessorFn: (row) => nodeStatusAt(row, now ?? undefined),
        cell: ({ row }) => (
          <NodeStatusLine
            node={{
              maintenance: row.original.maintenance,
              // `toNodeRow` ramène l'absence à l'époque Unix ; on la rend ici
              // pour dire « jamais joint » plutôt qu'« il y a 56 ans ».
              lastHeartbeatAt:
                new Date(row.original.lastHeartbeatAt).getTime() === 0
                  ? null
                  : row.original.lastHeartbeatAt,
            }}
            now={now ?? undefined}
          />
        ),
      },
      {
        id: "capacity",
        header: t("columnCapacity"),
        size: 280,
        // Le tri porte sur le taux d'occupation : 96 Go sur 128 est plus
        // critique que 178 Go sur 256.
        accessorFn: (row) => row.allocatedMemoryMb / row.memoryTotalMb,
        cell: ({ row }) => {
          const n = row.original;
          const measured = hasLiveMetrics(nodeStatusAt(n, now ?? undefined))
            ? n.measuredMemoryMb
            : null;
          return (
            <div className="flex w-60 flex-col gap-2">
              <MetricBar
                label={t("memoryPromised")}
                value={n.allocatedMemoryMb}
                max={n.memoryTotalMb}
                tone="auto"
                format={(v) => formatMb(v, 0)}
              />
              <MetricBar
                label={t("diskPromised")}
                value={n.allocatedDiskMb}
                max={n.diskTotalMb}
                tone="auto"
                format={(v) => formatMb(v, 0)}
              />
              {/* Rien faute de relevé : « 0 Mo consommés » affirmerait ce
                  qu'on n'a pas mesuré. */}
              {measured !== null ? (
                <p className="text-faint text-xs">
                  {t("measuredNow", { used: formatMb(measured, 0), count: n.measuredServers })}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "servers",
        header: t("columnServers"),
        cell: ({ getValue }) => <span className="text-fg">{getValue() as number}</span>,
      },
      {
        accessorKey: "ownerName",
        header: t("columnOperator"),
        cell: ({ row }) =>
          // « Plateforme » et non un tiret : un node sans revendeur n'est pas
          // un node sans exploitant.
          row.original.ownerName ? (
            <Badge variant="accent">{row.original.ownerName}</Badge>
          ) : (
            <span className="text-faint">{t("operatorPlatform")}</span>
          ),
      },
      {
        accessorKey: "version",
        header: t("columnWingsVersion"),
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-2">
            <span className="gd-mono text-muted text-xs">{row.original.version}</span>
            {isOutdated(row.original.version, latest ?? "") ? (
              <Badge variant="warning" title={t("outdatedHint", { latest: latest ?? "" })}>
                <ArrowUpCircle className="size-3" />
                {latest}
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        size: 60,
        enableSorting: false,
        cell: ({ row }) => (
          // Le menu vit dans la ligne cliquable : sans cet arrêt, choisir une
          // entrée ouvrirait aussi la fiche.
          // biome-ignore lint/a11y/noStaticElementInteractions: arrêt de propagation seulement, aucune action propre.
          // biome-ignore lint/a11y/useKeyWithClickEvents: idem, le clavier atteint le menu lui-même.
          <div onClick={(event) => event.stopPropagation()}>
            <RowActions label={t("rowActions")}>
              <DropdownItem icon={<FileText />} onSelect={() => onOpen(row.original)}>
                {t("openSheet")}
              </DropdownItem>
              <DropdownItem icon={<Network />} onSelect={() => onOpen(row.original, "ports")}>
                {t("managePorts")}
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem
                icon={<Power />}
                disabled={pending}
                onSelect={() => onToggleMaintenance(row.original)}
              >
                {row.original.maintenance ? t("leaveMaintenance") : t("enterMaintenance")}
              </DropdownItem>
            </RowActions>
          </div>
        ),
      },
    ],
    [t, now, latest, pending, onToggleMaintenance, onOpen],
  );
}
