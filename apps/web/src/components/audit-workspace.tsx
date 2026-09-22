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
  SelectMenu,
} from "@gamedashboard/ui";
import { History, Search } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { AuditPage } from "@/server/api/audit";

/**
 * Mêmes tons que le journal d'un serveur.
 *
 * Recopiés plutôt que partagés parce que les deux écrans peuvent diverger — ce
 * journal-ci montre des familles que l'autre ne voit jamais — mais le `Record`
 * reste exhaustif : une catégorie ajoutée au contrat casse la compilation ici,
 * ce qui vaut mieux qu'une pastille sans couleur découverte à l'écran.
 */
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
  account: "warning",
};

/**
 * Familles d'événements proposées au filtre.
 *
 * Des **préfixes**, et non une liste exhaustive : les événements se comptent
 * par dizaines et s'ajoutent au fil du développement. Un menu qui les
 * énumérerait tous serait faux dès la fonctionnalité suivante, là où
 * « account. » restera juste.
 */
const FAMILIES = ["", "account.", "server.", "backup.", "database.", "node.", "user."];

/**
 * Le journal de toute la plateforme.
 *
 * Il existe parce qu'une partie de ce que le panel consigne n'avait **aucun
 * lecteur** : les événements de compte ne sont rattachés à aucun serveur, et
 * l'écran d'activité d'un serveur ne pouvait donc pas les montrer. Un journal
 * qu'on ne peut pas consulter ne prouve rien.
 *
 * Les filtres passent par l'adresse plutôt que par un état local : une
 * recherche qui a trouvé quelque chose se transmet, et se retrouve dans
 * l'historique du navigateur — ce qui compte quand on répond à une question
 * posée par écrit.
 */
export function AuditWorkspace({
  page,
  query,
  event,
}: {
  page: AuditPage;
  query: string;
  event: string;
}) {
  const t = useTranslations("audit");
  const ta = useTranslations("activity");
  const router = useRouter();
  const parameters = useSearchParams();
  const [search, setSearch] = useState(query);

  const go = (changes: Record<string, string>) => {
    const next = new URLSearchParams(parameters.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === "") next.delete(key);
      else next.set(key, value);
    }
    // Toute modification de filtre ramène à la première page : rester en
    // page 4 d'un résultat qui n'en compte qu'une afficherait une liste vide
    // sans que rien n'explique pourquoi.
    if (!("page" in changes)) next.delete("page");
    router.push(`/admin/audit${next.toString() ? `?${next}` : ""}`);
  };

  const columns = useMemo<ColumnDef<AuditPage["items"][number], unknown>[]>(
    () => [
      {
        accessorKey: "event",
        header: t("columnEvent"),
        cell: ({ row }) => {
          const { category } = describeActivity(row.original.event);
          return (
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate font-semibold text-fg">
                {row.original.event}
                <Badge variant={CATEGORY_TONE[category]}>
                  {ACTIVITY_CATEGORY_LABELS[category]}
                </Badge>
              </p>
              {/* Le serveur concerné, quand il y en a un. Son absence n'est pas
                  un trou : c'est ce qui distingue un événement de compte. */}
              {row.original.serverId ? (
                <Link
                  href={`/admin/servers/${row.original.serverId}`}
                  className="text-muted text-xs hover:text-accent hover:underline"
                >
                  {row.original.serverName ?? row.original.serverId}
                </Link>
              ) : (
                <span className="text-faint text-xs">{t("platformScope")}</span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "actorLabel",
        header: t("columnActor"),
        cell: ({ row }) =>
          row.original.actorType === "system" ? (
            <span className="text-muted">{row.original.actorLabel}</span>
          ) : (
            <span className="flex items-center gap-2.5">
              <Avatar name={row.original.actorLabel} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-fg">{row.original.actorLabel}</span>
                {row.original.actorType === "api_key" ? (
                  <span className="block text-warning-ink text-xs">{ta("viaApiKey")}</span>
                ) : null}
              </span>
            </span>
          ),
      },
      {
        accessorKey: "ip",
        header: t("columnIp"),
        cell: ({ getValue }) => {
          const ip = getValue() as string | null;
          return ip ? (
            <span className="gd-mono text-muted text-xs">{ip}</span>
          ) : (
            <span className="text-faint">—</span>
          );
        },
      },
      {
        accessorKey: "at",
        header: t("columnWhen"),
        cell: ({ getValue }) => (
          <RelativeTime className="text-muted" value={getValue() as string} />
        ),
      },
    ],
    [t, ta],
  );

  return (
    <PageTemplate
      header={<PageHeader icon={<History />} title={t("title")} subtitle={t("subtitle")} />}
      toolbar={
        <div className="flex flex-wrap items-end gap-3 rounded-card border border-border bg-surface px-5 py-4 shadow-card">
          <form
            className="flex min-w-64 flex-1 items-center gap-2"
            onSubmit={(submitted) => {
              submitted.preventDefault();
              go({ query: search.trim() });
            }}
          >
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchPlaceholder")}
              leadingIcon={<Search />}
            />
            <Button type="submit" variant="secondary">
              {t("search")}
            </Button>
          </form>

          <SelectMenu
            className="min-w-52"
            value={event}
            onValueChange={(value) => go({ event: value })}
            options={FAMILIES.map((family) => ({
              value: family,
              label: family === "" ? t("allFamilies") : family,
            }))}
          />
        </div>
      }
    >
      <DataTable
        columns={columns}
        data={page.items}
        getRowId={(row) => row.id}
        emptyState={
          <EmptyState icon={<History />} title={t("emptyTitle")} description={t("emptyBody")} />
        }
      />

      {/*
       * Pagination par « il y a une suite », sans total.
       *
       * Le journal grossit sans fin : compter ses lignes à chaque affichage
       * coûterait un balayage complet de la table pour un chiffre que personne
       * ne lit. On demande une ligne de plus que la page, et c'est elle qui
       * répond à la seule question utile.
       */}
      {page.page > 1 || page.hasMore ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="secondary"
            disabled={page.page <= 1}
            onClick={() => go({ page: String(page.page - 1) })}
          >
            {t("previous")}
          </Button>
          <span className="text-muted text-sm">{t("pageNumber", { page: page.page })}</span>
          <Button
            variant="secondary"
            disabled={!page.hasMore}
            onClick={() => go({ page: String(page.page + 1) })}
          >
            {t("next")}
          </Button>
        </div>
      ) : null}
    </PageTemplate>
  );
}
