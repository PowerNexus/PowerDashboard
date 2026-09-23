"use client";

import {
  AlertBanner,
  Badge,
  Button,
  type ColumnDef,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FormField,
  Input,
  SettingsSection,
} from "@gamedashboard/ui";
import { Network, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState, useTransition } from "react";
import { addNodeAllocations } from "@/server/api/admin-actions";
import type { AdminNodeAllocation } from "@/server/api/admin-node";
import { removeNodeAllocations } from "@/server/api/admin-node-actions";

/**
 * Le stock de ports d'une machine.
 *
 * Un serveur de jeu écoute sur un port de la machine ; sans port libre, aucun
 * serveur ne peut y être créé — et le refus arrive sous la forme d'un « aucune
 * machine disponible » que rien n'explique. D'où la première phrase de la
 * section, et l'ajout par plage.
 *
 * Un port **occupé** ne se coche pas : l'API le refuserait, et le serveur qui
 * y écoute est nommé en face pour qu'on sache où aller le libérer.
 */
export function AdminNodePorts({
  node,
  allocations,
}: {
  node: { id: string; name: string };
  allocations: AdminNodeAllocation[];
}) {
  const t = useTranslations("nodeAdmin");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ip, setIp] = useState(allocations[0]?.ip ?? "");
  const [from, setFrom] = useState("25565");
  const [to, setTo] = useState("25575");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const free = allocations.filter((a) => a.serverId === null);
  const toggle = useCallback(
    (id: string) =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const add = () =>
    startTransition(async () => {
      const result = await addNodeAllocations(node.id, ip.trim(), Number(from), Number(to || from));
      setError(result.error);
      setNotice(result.error ? null : t("portsAdded"));
      if (!result.error) router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      setConfirming(false);
      const result = await removeNodeAllocations(node.id, [...selected]);
      setError(result.error);
      setNotice(result.error ? null : t("portsRemoved", { count: result.removed }));
      if (!result.error) {
        setSelected(new Set());
        router.refresh();
      }
    });

  const columns = useMemo<ColumnDef<AdminNodeAllocation, unknown>[]>(
    () => [
      {
        id: "select",
        header: "",
        size: 40,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.serverId === null ? (
            <input
              type="checkbox"
              aria-label={t("selectPort", { port: row.original.port })}
              checked={selected.has(row.original.id)}
              onChange={() => toggle(row.original.id)}
              className="size-4 accent-accent"
            />
          ) : null,
      },
      {
        id: "address",
        header: t("portColumnAddress"),
        accessorFn: (row) => `${row.ip}:${row.port}`,
        cell: ({ row }) => (
          <span className="gd-mono text-fg">
            {row.original.ip}:{row.original.port}
            {row.original.ipAlias ? (
              <span className="ml-2 text-muted text-xs">{row.original.ipAlias}</span>
            ) : null}
          </span>
        ),
      },
      {
        id: "usage",
        header: t("portColumnUsage"),
        cell: ({ row }) =>
          row.original.serverId === null ? (
            <Badge variant="success">{t("portFree")}</Badge>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral">
                {row.original.isPrimary ? t("portPrimary") : t("portExtra")}
              </Badge>
              <Link
                href={`/admin/servers/${row.original.serverId}`}
                className="text-accent text-sm hover:underline"
              >
                {row.original.serverName}
              </Link>
            </span>
          ),
      },
    ],
    [t, selected, toggle],
  );

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}
      {notice ? (
        <AlertBanner variant="success" dismissible>
          {notice}
        </AlertBanner>
      ) : null}

      <SettingsSection
        title={t("portsAddTitle")}
        description={t("portsAddHint")}
        footer={
          <Button disabled={pending || ip.trim() === "" || !from} onClick={add}>
            <Plus /> {t("portsAddAction")}
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label={tc("ipAddress")} description={t("portsIpHint")}>
            {(id) => (
              <Input
                id={id}
                className="gd-mono"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="203.0.113.10"
              />
            )}
          </FormField>
          <FormField label={t("portFrom")} description={t("portRangeHint")}>
            {(id) => (
              <Input
                id={id}
                type="number"
                className="gd-mono"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            )}
          </FormField>
          <FormField label={t("portTo")}>
            {(id) => (
              <Input
                id={id}
                type="number"
                className="gd-mono"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            )}
          </FormField>
        </div>
      </SettingsSection>

      <SettingsSection
        title={t("portsStockTitle", { free: free.length, total: allocations.length })}
        description={t("portsStockHint")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={free.length === 0}
              onClick={() =>
                setSelected(
                  selected.size === free.length ? new Set() : new Set(free.map((a) => a.id)),
                )
              }
            >
              {selected.size === free.length && free.length > 0
                ? t("portsSelectNone")
                : t("portsSelectFree")}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={pending || selected.size === 0}
              onClick={() => setConfirming(true)}
            >
              <Trash2 /> {t("portsRemoveAction", { count: selected.size })}
            </Button>
          </div>
        }
      >
        <DataTable
          columns={columns}
          data={allocations}
          getRowId={(row) => row.id}
          emptyState={
            <EmptyState
              icon={<Network />}
              title={t("portsEmpty")}
              description={t("portsEmptyHint")}
            />
          }
        />
      </SettingsSection>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("portsRemoveTitle", { count: selected.size })}
        description={t("portsRemoveBody", { name: node.name })}
        confirmLabel={t("portsRemoveConfirm")}
        cancelLabel={tc("cancel")}
        destructive
        loading={pending}
        onConfirm={remove}
      />
    </div>
  );
}
