"use client";

import {
  ACTIVITY_CATEGORY_LABELS,
  type ActivityCategory,
  describeActivity,
} from "@gamedashboard/contracts";
import {
  Avatar,
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  EmptyState,
  Input,
  PageHeader,
  PageTemplate,
  RelativeTime,
} from "@gamedashboard/ui";
import { History, Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { ActivityEntry, ActivityPage } from "@/server/api/activity";

const CATEGORY_TONE: Record<
  ActivityCategory,
  "accent" | "info" | "warning" | "danger" | "neutral"
> = {
  power: "accent",
  console: "accent",
  files: "info",
  backups: "neutral",
  databases: "neutral",
  network: "info",
  access: "warning",
  schedules: "neutral",
  settings: "danger",
  // Les événements de compte n'ont pas de serveur rattaché et ne remontent
  // donc pas dans ce journal-ci, qui est celui d'un serveur. Ils se lisent dans
  // le journal de la plateforme, côté administration. L'entrée existe pour que
  // la table reste exhaustive.
  account: "neutral",
};

/**
 * Journal d'activité.
 *
 * En ajout seul : rien ici ne modifie quoi que ce soit, et c'est la raison
 * d'être de l'écran. Un journal qu'on peut retoucher ne prouve rien.
 *
 * La recherche est portée par l'URL plutôt que par un état local : le lien
 * d'une recherche se partage, et un retour arrière retrouve ce qu'on regardait.
 */
export function ActivityWorkspace({
  serverId,
  initial,
}: {
  serverId: string;
  initial: ActivityPage;
}) {
  const t = useTranslations("activity");
  const tc = useTranslations("common");
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");

  const go = (next: { q?: string; page?: number }) => {
    const search = new URLSearchParams();
    const q = next.q ?? query;
    if (q.trim() !== "") search.set("q", q.trim());
    if (next.page && next.page > 1) search.set("page", String(next.page));
    router.push(`/server/${serverId}/activity${search.size > 0 ? `?${search}` : ""}`);
  };

  const columns = useMemo<ColumnDef<ActivityEntry, unknown>[]>(
    () => [
      {
        accessorKey: "event",
        header: t("columnEvent"),
        cell: ({ row }) => {
          const described = describeActivity(row.original.event);
          const detail = summarize(row.original.properties);
          return (
            <div className="min-w-0">
              <p className="truncate text-fg">{described.label}</p>
              {detail ? <p className="gd-mono truncate text-xs text-muted">{detail}</p> : null}
            </div>
          );
        },
      },
      {
        id: "category",
        header: t("columnCategory"),
        cell: ({ row }) => {
          const { category } = describeActivity(row.original.event);
          return (
            <Badge variant={CATEGORY_TONE[category]}>{ACTIVITY_CATEGORY_LABELS[category]}</Badge>
          );
        },
      },
      {
        accessorKey: "actorLabel",
        header: t("columnActor"),
        cell: ({ row }) => {
          // Les trois natures d'acteur se distinguent à l'œil : c'est la
          // première question de quiconque découvre une action qu'il ne
          // reconnaît pas — moi, mon bot, ou le système ?
          if (row.original.actorType === "system") {
            return <span className="text-muted">{row.original.actorLabel}</span>;
          }
          return (
            <span className="flex items-center gap-2.5">
              <Avatar name={row.original.actorLabel} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-fg">{row.original.actorLabel}</span>
                {row.original.actorType === "api_key" ? (
                  <span className="block text-xs text-warning-ink">{t("viaApiKey")}</span>
                ) : null}
              </span>
            </span>
          );
        },
      },
      {
        accessorKey: "ip",
        header: t("columnIp"),
        cell: ({ getValue }) => (
          // « — » et non une case vide : une origine inconnue est une
          // information, pas une absence de colonne.
          <span className="gd-mono text-muted">{(getValue() as string | null) ?? "—"}</span>
        ),
      },
      {
        accessorKey: "at",
        header: t("columnWhen"),
        cell: ({ getValue }) => (
          <RelativeTime className="text-muted" value={getValue() as string} />
        ),
      },
    ],
    [t],
  );

  return (
    <PageTemplate
      header={<PageHeader icon={<History />} title={t("title")} subtitle={t("subtitle")} />}
      toolbar={
        <form
          className="flex flex-wrap gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            go({ page: 1 });
          }}
        >
          <Input
            className="min-w-64 flex-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            leadingIcon={<Search />}
          />
          <Button type="submit" variant="secondary">
            {tc("search")}
          </Button>
        </form>
      }
    >
      <DataTable
        columns={columns}
        data={initial.items}
        getRowId={(row) => row.id}
        emptyState={
          <EmptyState
            icon={<History />}
            title={t("empty")}
            description={query ? t("emptyFiltered") : t("emptyHint")}
          />
        }
      />

      {/* Pagination par page suivante seulement : compter les lignes d'un
          journal qui grossit sans fin coûterait plus que ça ne rapporte. */}
      {initial.page > 1 || initial.hasMore ? (
        <div className="flex items-center justify-between gap-4">
          <Button
            variant="secondary"
            disabled={initial.page <= 1}
            onClick={() => go({ page: initial.page - 1 })}
          >
            {tc("previous")}
          </Button>
          <span className="text-sm text-muted">{tc("page", { page: initial.page })}</span>
          <Button
            variant="secondary"
            disabled={!initial.hasMore}
            onClick={() => go({ page: initial.page + 1 })}
          >
            {tc("next")}
          </Button>
        </div>
      ) : null}
    </PageTemplate>
  );
}

/**
 * Détail lisible d'un événement.
 *
 * Les propriétés varient d'un événement à l'autre — un chemin, un signal, une
 * liste de permissions. On les rend telles quelles plutôt que de prévoir un
 * gabarit par événement : le journal doit rester lisible pour un événement
 * ajouté après cette version, et un gabarit manquant afficherait du vide.
 */
function summarize(properties: Record<string, unknown>): string | null {
  const entries = Object.entries(properties).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return null;

  return entries
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join(" · ");
}
