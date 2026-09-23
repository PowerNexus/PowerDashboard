"use client";

import type { PlatformAccess } from "@gamedashboard/contracts";
import {
  groupNodes,
  isOutdated,
  isSelectionCoherent,
  latestVersion as latestOf,
  type NodeGroupBy,
  subcategoriesOf,
} from "@gamedashboard/contracts";
import {
  AlertBanner,
  Badge,
  Button,
  DataTable,
  EmptyState,
  Input,
  PageHeader,
  PageTemplate,
  SelectMenu,
} from "@gamedashboard/ui";
import { ChevronDown, HardDrive, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { NodeRow } from "@/lib/admin-view";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import type { AdminLocation, AdminNodeTaxonomy } from "@/server/api/admin";
import { setNodeMaintenance } from "@/server/api/admin-actions";
import { AdminNodeTaxonomyDialog } from "./admin-node-taxonomy";
import { useNodeColumns } from "./admin-nodes-columns";
import { nodeStatusAt } from "./node-status-line";

/**
 * Revendeur proposé à l'attribution d'un node.
 *
 * Seuls les comptes `reseller` en font partie : attribuer une machine à un
 * client ordinaire lui donnerait de la capacité sans lui ouvrir l'espace qui
 * permet de la voir. L'API refuse de toute façon.
 */
export interface ResellerOption {
  id: string;
  name: string;
  email: string;
  /** Autorise-t-il l'administration à provisionner chez lui ? Information, pas condition. */
  platformAccess: PlatformAccess;
}

/**
 * La liste des machines.
 *
 * Elle répond à trois questions et ne fait rien d'autre : **qu'est-ce qu'un
 * node** (la phrase de tête, pour qui n'a jamais vu Pterodactyl), **lesquelles
 * vont mal** (l'état en clair, depuis quand), **où reste-t-il de la place**
 * (les jauges). Les gestes vivent sur la fiche de chaque machine, où chacun a
 * la place d'expliquer ce qu'il provoque ; la ligne n'en garde que trois.
 */
export function AdminNodes({
  initial,
  taxonomy,
  locations,
}: {
  initial: NodeRow[];
  taxonomy: AdminNodeTaxonomy;
  locations: AdminLocation[];
}) {
  const t = useTranslations("nodeAdmin");
  const ta = useTranslations("adminNodes");
  const tc = useTranslations("common");
  const ts = useTranslations("nodeStatus");
  const router = useRouter();
  const nodes = initial;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /*
   * Redemande les nodes pendant que la page reste ouverte, et réévalue l'état
   * entre deux rafraîchissements : l'état d'un node n'est pas une valeur reçue
   * mais une conclusion tirée de l'âge du dernier contact, donc de l'heure.
   * Les deux vont ensemble ; aucune ne suffit seule.
   */
  useAutoRefresh();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [subcategoryId, setSubcategoryId] = useState("all");
  const [status, setStatus] = useState("all");
  const [groupBy, setGroupBy] = useState<NodeGroupBy>("category");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  /** Un node en maintenance n'accueille plus de serveur, mais garde les siens. */
  const toggleMaintenance = useCallback(
    (node: NodeRow) =>
      startTransition(async () => {
        const result = await setNodeMaintenance(node.id, !node.maintenance);
        setError(result.error);
        if (!result.error) router.refresh();
      }),
    [router],
  );

  const open = useCallback(
    (node: NodeRow, section?: string) =>
      router.push(`/admin/nodes/${node.id}${section ? `?section=${section}` : ""}`),
    [router],
  );

  /** Changer de catégorie invalide une sous-catégorie qui n'en dépend pas. */
  const selectCategory = useCallback(
    (next: string) => {
      setCategoryId(next);
      setSubcategoryId((current) =>
        isSelectionCoherent(taxonomy.subcategories, next, current) ? current : "all",
      );
    },
    [taxonomy],
  );

  const latest = useMemo(() => latestOf(nodes.map((n) => n.version)), [nodes]);
  const outdated = useMemo(
    () => nodes.filter((n) => isOutdated(n.version, latest)),
    [nodes, latest],
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return nodes.filter((node) => {
      if (categoryId !== "all" && node.categoryId !== categoryId) return false;
      if (subcategoryId !== "all" && node.subcategoryId !== subcategoryId) return false;
      if (status !== "all" && nodeStatusAt(node, now ?? undefined) !== status) return false;
      if (!q) return true;
      return [node.name, node.fqdn, node.location].some((v) => v.toLowerCase().includes(q));
    });
  }, [nodes, query, categoryId, subcategoryId, status, now]);

  const groups = useMemo(
    () =>
      groupNodes(filtered, {
        categories: taxonomy.categories,
        subcategories: taxonomy.subcategories,
        groupBy,
      }),
    [filtered, groupBy, taxonomy],
  );

  const columns = useNodeColumns({
    now,
    latest,
    pending,
    onToggleMaintenance: toggleMaintenance,
    onOpen: open,
  });

  const resetFilters = () => {
    setQuery("");
    setCategoryId("all");
    setSubcategoryId("all");
    setStatus("all");
  };
  const hasFilters =
    query !== "" || categoryId !== "all" || subcategoryId !== "all" || status !== "all";

  // Sans localisation, aucune machine ne peut être déclarée : le bouton le
  // montre éteint plutôt que de mener à un formulaire voué au refus.
  const addMachine =
    locations.length === 0 ? (
      <Button disabled>
        <Plus /> {t("addMachine")}
      </Button>
    ) : (
      <Button asChild>
        <Link href="/admin/nodes/new">
          <Plus /> {t("addMachine")}
        </Link>
      </Button>
    );

  return (
    <PageTemplate
      header={
        <PageHeader
          icon={<HardDrive />}
          title={t("title")}
          subtitle={t("intro")}
          actions={
            <div className="flex flex-wrap gap-2">
              <AdminNodeTaxonomyDialog taxonomy={taxonomy} locations={locations} />
              {addMachine}
            </div>
          }
        />
      }
      toolbar={
        nodes.length === 0 ? null : (
          <div className="flex flex-col gap-3">
            {error ? (
              <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
                {error}
              </AlertBanner>
            ) : null}
            {outdated.length > 0 ? (
              <AlertBanner variant="warning" title={ta("outdated", { count: outdated.length })}>
                {ta.rich("outdatedBody", {
                  nodes: outdated.map((n) => `${n.name} (${n.version})`).join(", "),
                  latest,
                  b: (chunks) => <strong>{chunks}</strong>,
                })}
              </AlertBanner>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Input
                className="min-w-56 flex-1"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={ta("searchPlaceholder")}
                leadingIcon={<Search />}
              />
              <SelectMenu
                className="w-48"
                value={categoryId}
                onValueChange={selectCategory}
                aria-label={ta("filterCategory")}
                options={[
                  { value: "all", label: ta("allCategories") },
                  ...taxonomy.categories.map((c) => ({
                    value: c.id,
                    label: c.name,
                    description: c.description ?? undefined,
                  })),
                ]}
              />
              <SelectMenu
                className="w-48"
                value={subcategoryId}
                onValueChange={setSubcategoryId}
                aria-label={ta("filterSubcategory")}
                options={[
                  { value: "all", label: ta("allSubcategories") },
                  ...subcategoriesOf(taxonomy.subcategories, categoryId).map((s) => ({
                    value: s.id,
                    label: s.name,
                  })),
                ]}
              />
              <SelectMenu
                className="w-44"
                value={status}
                onValueChange={setStatus}
                aria-label={ta("filterStatus")}
                options={[
                  { value: "all", label: ta("allStatuses") },
                  ...(["online", "stale", "maintenance", "unreachable"] as const).map((s) => ({
                    value: s,
                    label: ts(s),
                  })),
                ]}
              />
              <SelectMenu
                className="w-44"
                value={groupBy}
                onValueChange={(v) => setGroupBy(v as NodeGroupBy)}
                aria-label={ta("groupBy")}
                options={[
                  { value: "category", label: ta("groupByCategory") },
                  { value: "subcategory", label: ta("groupBySubcategory") },
                  { value: "none", label: ta("groupByNone") },
                ]}
              />
              {hasFilters ? (
                <Button variant="ghost" onClick={resetFilters}>
                  {ta("resetFilters")}
                </Button>
              ) : null}
            </div>
          </div>
        )
      }
    >
      {nodes.length === 0 ? (
        /* Le premier écran d'une installation neuve : il dit par où commencer,
           dans l'ordre, au lieu d'un « aucun résultat » qui ne guide personne. */
        <EmptyState
          icon={<HardDrive />}
          title={t("emptyTitle")}
          description={locations.length === 0 ? t("emptyNeedsLocation") : t("emptyBody")}
          action={locations.length === 0 ? undefined : addMachine}
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title={ta("empty")}
          description={tc("adjustFilters")}
          action={
            <Button variant="secondary" onClick={resetFilters}>
              {ta("resetFiltersLong")}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-faint text-xs">{t("capacityLegend")}</p>
          {groups.map((group) => {
            const isCollapsed = collapsed[group.key] ?? false;
            const unreachable = group.nodes.filter(
              (n) => nodeStatusAt(n, now ?? undefined) === "unreachable",
            ).length;
            return (
              <section key={group.key} className="flex flex-col gap-3">
                {groupBy !== "none" ? (
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [group.key]: !isCollapsed }))}
                    aria-expanded={!isCollapsed}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-field px-1 py-1 text-left transition-colors hover:bg-surface-2"
                  >
                    <ChevronDown
                      className={`size-4 shrink-0 text-muted transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                    />
                    <span className="font-semibold text-fg">{group.label}</span>
                    <Badge variant="neutral">
                      {ta("groupNodes", { count: group.nodes.length })}
                    </Badge>
                    {unreachable > 0 ? (
                      <Badge variant="danger">
                        {ta("groupUnreachable", { count: unreachable })}
                      </Badge>
                    ) : null}
                  </button>
                ) : null}
                {!isCollapsed ? (
                  <DataTable
                    columns={columns}
                    data={group.nodes}
                    getRowId={(row) => row.id}
                    onRowClick={(row) => open(row)}
                  />
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </PageTemplate>
  );
}
