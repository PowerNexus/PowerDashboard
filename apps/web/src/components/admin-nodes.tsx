"use client";

import type { PlatformAccess } from "@gamedashboard/contracts";
import {
  groupNodes,
  hasLiveMetrics,
  isOutdated,
  isSelectionCoherent,
  latestVersion as latestOf,
  NODE_STATUS_TONE,
  type NodeGroupBy,
  type NodeStatus,
  nodeStatus,
  platformMayProvision,
  subcategoriesOf,
} from "@gamedashboard/contracts";
import {
  AlertBanner,
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  Dialog,
  DialogContent,
  DropdownItem,
  DropdownSeparator,
  EmptyState,
  FormField,
  formatMb,
  Input,
  MetricBar,
  PageHeader,
  PageTemplate,
  RelativeTime,
  RowActions,
  SelectMenu,
  StatusDot,
} from "@gamedashboard/ui";
import {
  Activity,
  ArrowUpCircle,
  ChevronDown,
  HardDrive,
  KeyRound,
  Layers,
  Network,
  Power,
  Search,
  Store,
  Terminal,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { NodeRow } from "@/lib/admin-view";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import type { AdminLocation, AdminNodeTaxonomy } from "@/server/api/admin";
import {
  addNodeAllocations,
  removeNode,
  rotateNodeToken,
  setNodeMaintenance,
  setNodeOwner,
} from "@/server/api/admin-actions";
import { AdminNodeConfigure } from "./admin-node-configure";
import { AdminNodeCreate } from "./admin-node-create";
import { AdminNodeLoad } from "./admin-node-load";
import { AdminNodeShares } from "./admin-node-shares";
import { AdminNodeTaxonomyDialog } from "./admin-node-taxonomy";

const BADGE_BY_STATUS: Record<NodeStatus, "success" | "warning" | "danger"> = NODE_STATUS_TONE;

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

export function AdminNodes({
  initial,
  resellers = [],
  taxonomy,
  panelOrigin,
  locations,
}: {
  initial: NodeRow[];
  resellers?: ResellerOption[];
  taxonomy: AdminNodeTaxonomy;
  /** Origine publique du panel, telle que le serveur la connaît — jamais devinée depuis le navigateur. */
  panelOrigin: string;
  locations: AdminLocation[];
}) {
  const t = useTranslations("adminNodes");
  const tc = useTranslations("common");
  const ts = useTranslations("nodeStatus");
  const router = useRouter();
  const nodes = initial;
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [toAllocate, setToAllocate] = useState<NodeRow | null>(null);
  const [toAssign, setToAssign] = useState<NodeRow | null>(null);
  const [toShare, setToShare] = useState<NodeRow | null>(null);
  const [toConfigure, setToConfigure] = useState<NodeRow | null>(null);
  const [toRemove, setToRemove] = useState<NodeRow | null>(null);
  const [toRotate, setToRotate] = useState<NodeRow | null>(null);
  const [toInspect, setToInspect] = useState<NodeRow | null>(null);

  /**
   * Redemande les nodes au serveur pendant que la page reste ouverte.
   *
   * **Il manquait la moitié du travail.** L'horloge ci-dessous existait déjà et
   * recalculait l'état à chaque battement — l'état d'un node n'est pas une
   * valeur reçue mais une conclusion tirée de l'âge du dernier contact, donc de
   * l'heure qu'il est. Seulement l'instant du dernier contact, lui, n'était
   * jamais redemandé : le calcul restait juste sur une donnée qui vieillissait
   * indéfiniment. On avait remplacé un « Opérationnel » figé par un
   * « Injoignable — il y a 11 minutes » sur un node qui battait à la seconde.
   *
   * Les deux vont ensemble et aucune ne suffit : celle-ci rapporte le fait,
   * celle-là en tire la conclusion entre deux rapports.
   */
  useAutoRefresh();

  /**
   * Réévalue l'état entre deux rafraîchissements.
   *
   * Dix secondes, la cadence à laquelle le panel sonde les nodes silencieux :
   * plus souvent n'apprendrait rien de neuf.
   */
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  // « plateforme » plutôt qu'une chaîne vide : rendre un node est un choix, pas
  // l'absence de choix.
  const [assignee, setAssignee] = useState<string>("platform");
  const [ip, setIp] = useState("127.0.0.1");
  const [from, setFrom] = useState("25565");
  const [to, setTo] = useState("25575");
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [subcategoryId, setSubcategoryId] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<NodeGroupBy>("category");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  /**
   * Bascule la maintenance côté serveur.
   *
   * Un node en maintenance n'accueille plus de nouveau serveur mais continue de
   * faire tourner les siens : c'est ce qui rend le bouton utilisable pendant
   * une intervention, sans couper les clients.
   */
  const toggleMaintenance = useCallback(
    (id: string, next: boolean) =>
      startTransition(async () => {
        const result = await setNodeMaintenance(id, next);
        setError(result.error);
        if (!result.error) router.refresh();
      }),
    [router],
  );

  /** Changer de catégorie invalide une sous-catégorie qui n'en dépend pas. */
  const selectCategory = useCallback(
    (next: string) => {
      setCategoryId(next);
      setSubcategoryId((current) =>
        isSelectionCoherent(taxonomy.subcategories, next, current) ? current : "all",
      );
      // `taxonomy` est une dépendance réelle : sans elle, une sous-catégorie
      // ajoutée resterait invisible au filtre jusqu'au rechargement complet.
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
      if (status !== "all" && nodeStatus(node) !== status) return false;
      if (!q) return true;
      return (
        node.name.toLowerCase().includes(q) ||
        node.fqdn.toLowerCase().includes(q) ||
        node.location.toLowerCase().includes(q)
      );
    });
  }, [nodes, query, categoryId, subcategoryId, status]);

  const groups = useMemo(
    () =>
      groupNodes(filtered, {
        categories: taxonomy.categories,
        subcategories: taxonomy.subcategories,
        groupBy,
      }),
    [filtered, groupBy, taxonomy],
  );

  const columns = useMemo<ColumnDef<NodeRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columnNode"),
        cell: ({ row }) => {
          const n = row.original;
          const state = nodeStatus(n, now ?? undefined);
          return (
            <div className="flex items-start gap-3">
              <StatusDot
                className="mt-1.5"
                tone={NODE_STATUS_TONE[state]}
                pulse={state === "maintenance" || state === "stale"}
                label={ts(state)}
              />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-fg">
                  {n.name}
                  {state !== "online" ? (
                    <Badge variant={BADGE_BY_STATUS[state]}>{ts(state)}</Badge>
                  ) : null}
                </p>
                <p className="gd-mono text-xs text-muted">{n.fqdn}</p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "location",
        header: t("columnLocation"),
        cell: ({ getValue }) => <span className="text-muted">{getValue() as string}</span>,
      },
      {
        accessorKey: "ownerName",
        header: t("columnOwner"),
        cell: ({ row }) =>
          // « Plateforme » et non un tiret : un node sans revendeur n'est pas
          // un node sans propriétaire.
          row.original.ownerName ? (
            <Badge variant="accent">{row.original.ownerName}</Badge>
          ) : (
            <span className="text-faint">{t("nodePlatform")}</span>
          ),
      },
      {
        accessorKey: "servers",
        header: t("columnServers"),
        cell: ({ getValue }) => <span className="text-fg">{getValue() as number}</span>,
      },
      {
        id: "memoryPct",
        header: t("columnCapacity"),
        size: 300,
        // Le tri porte sur le taux d'occupation, pas sur la valeur brute :
        // 96 Go sur 128 est plus critique que 178 Go sur 256.
        accessorFn: (row) => row.allocatedMemoryMb / row.memoryTotalMb,
        cell: ({ row }) => {
          const n = row.original;
          /*
           * Les jauges montrent l'**allocation**, pas la consommation.
           *
           * C'est elle qui répond à la question qu'on se pose devant cette
           * liste : reste-t-il de la place pour un serveur de plus ? Elle est
           * par ailleurs exacte en toutes circonstances, là où un relevé peut
           * manquer — un node vide affiche zéro, ce qui est vrai.
           *
           * La consommation réelle, quand on l'a, est dite en dessous : on vend
           * des limites, les clients en emploient une fraction, et confondre
           * les deux ferait croire une machine pleine alors qu'elle dort.
           */
          const measured = hasLiveMetrics(nodeStatus(n, now ?? undefined))
            ? n.measuredMemoryMb
            : null;
          return (
            <div className="flex w-64 flex-col gap-2">
              <MetricBar
                label={t("allocatedMemory")}
                value={n.allocatedMemoryMb}
                max={n.memoryTotalMb}
                format={(v) => formatMb(v, 0)}
              />
              <MetricBar
                label={t("allocatedDisk")}
                value={n.allocatedDiskMb}
                max={n.diskTotalMb}
                format={(v) => formatMb(v, 0)}
              />
              {/* Rien n'est affiché faute de relevé : une ligne « 0 Mo
                  consommés » affirmerait quelque chose qu'on n'a pas mesuré. */}
              {measured !== null ? (
                <p className="text-faint text-xs">
                  {t("measuredUsage", {
                    used: formatMb(measured, 0),
                    count: n.measuredServers,
                  })}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "lastHeartbeatAt",
        header: t("columnHeartbeat"),
        cell: ({ row }) => {
          const state = nodeStatus(row.original, now ?? undefined);
          return (
            <RelativeTime
              className={state === "unreachable" ? "text-danger-ink" : "text-muted"}
              value={row.original.lastHeartbeatAt}
            />
          );
        },
      },
      {
        accessorKey: "version",
        header: t("columnDaemon"),
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-2">
            <span className="gd-mono text-xs text-muted">
              {t("daemonPrefix")} {row.original.version}
            </span>
            {isOutdated(row.original.version, latest) ? (
              <Badge variant="warning">
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
        cell: ({ row }) => {
          const n = row.original;
          return (
            <RowActions>
              <DropdownItem
                icon={<Power />}
                disabled={pending}
                onSelect={() => toggleMaintenance(n.id, !n.maintenance)}
              >
                {n.maintenance ? t("leaveMaintenance") : t("enterMaintenance")}
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem icon={<Network />} onSelect={() => setToAllocate(n)}>
                {t("addPorts")}
              </DropdownItem>
              <DropdownItem icon={<Store />} onSelect={() => setToAssign(n)}>
                {n.ownerId ? t("changeOwner") : t("assignToReseller")}
              </DropdownItem>
              {/* Confier la machine entière et la découper sont deux gestes
                  exclusifs ; la fenêtre de répartition le dit et refuse. */}
              <DropdownItem icon={<Layers />} onSelect={() => setToShare(n)}>
                {t("manageShares")}
              </DropdownItem>
              <DropdownSeparator />
              {/* Réaffichable à volonté : la commande ne porte pas le jeton du
                  node, elle va le chercher. */}
              <DropdownItem icon={<Terminal />} onSelect={() => setToConfigure(n)}>
                {t("configureDaemon")}
              </DropdownItem>
              {/* Passe par une confirmation, mais n'est pas destructeur : le
                  panel ne retient le nouveau jeton que si le daemon a confirmé
                  le connaître. Un échec laisse l'ancien en service. */}
              <DropdownItem icon={<KeyRound />} onSelect={() => setToRotate(n)}>
                {t("rotateToken")}
              </DropdownItem>
              {/* La charge se demande, elle ne se précharge pas : une série par
                  ligne au rendu de la liste ferait autant d'agrégations que de
                  machines, pour un graphe qu'on n'ouvrira pas. */}
              <DropdownItem icon={<Activity />} onSelect={() => setToInspect(n)}>
                {t("viewLoad")}
              </DropdownItem>
              <DropdownSeparator />
              {/* Passe par une confirmation : une machine se redéclare, mais
                  son jeton est perdu et tous les daemons qui s'en servaient
                  sont à reconfigurer. */}
              <DropdownItem icon={<Trash2 />} destructive onSelect={() => setToRemove(n)}>
                {t("removeNode")}
              </DropdownItem>
            </RowActions>
          );
        },
      },
    ],
    [toggleMaintenance, latest, pending, t, ts, now],
  );

  const resetFilters = () => {
    setQuery("");
    setCategoryId("all");
    setSubcategoryId("all");
    setStatus("all");
  };

  const hasFilters =
    query !== "" || categoryId !== "all" || subcategoryId !== "all" || status !== "all";

  return (
    <PageTemplate
      header={
        <PageHeader
          icon={<HardDrive />}
          title={t("title")}
          subtitle={t("subtitle", {
            shown: filtered.length,
            total: nodes.length,
            categories: taxonomy.categories.length,
          })}
          actions={
            <div className="flex flex-wrap gap-2">
              <AdminNodeTaxonomyDialog taxonomy={taxonomy} locations={locations} />
              <AdminNodeCreate taxonomy={taxonomy} locations={locations} resellers={resellers} />
            </div>
          }
        />
      }
      toolbar={
        <div className="flex flex-col gap-3">
          {error ? (
            <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
              {error}
            </AlertBanner>
          ) : null}

          {outdated.length > 0 ? (
            <AlertBanner variant="warning" title={t("outdated", { count: outdated.length })}>
              {t.rich("outdatedBody", {
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
              placeholder={t("searchPlaceholder")}
              leadingIcon={<Search />}
            />
            <SelectMenu
              className="w-48"
              value={categoryId}
              onValueChange={selectCategory}
              aria-label={t("filterCategory")}
              options={[
                { value: "all", label: t("allCategories") },
                ...taxonomy.categories.map((c) => ({
                  value: c.id,
                  label: c.name,
                  // `?? undefined` : la base rend `null` pour « pas de description »,
                  // et le composant attend l'absence de la propriété.
                  description: c.description ?? undefined,
                  group: t("categories"),
                })),
              ]}
            />
            <SelectMenu
              className="w-48"
              value={subcategoryId}
              onValueChange={setSubcategoryId}
              aria-label={t("filterSubcategory")}
              options={[
                { value: "all", label: t("allSubcategories") },
                ...subcategoriesOf(taxonomy.subcategories, categoryId).map((s) => ({
                  value: s.id,
                  label: s.name,
                  description:
                    categoryId === "all"
                      ? taxonomy.categories.find((c) => c.id === s.categoryId)?.name
                      : undefined,
                  group: t("subcategories"),
                })),
              ]}
            />
            <SelectMenu
              className="w-44"
              value={status}
              onValueChange={setStatus}
              aria-label={t("filterStatus")}
              options={[
                { value: "all", label: t("allStatuses") },
                { value: "online", label: t("filterOnline") },
                { value: "stale", label: ts("stale") },
                { value: "maintenance", label: ts("maintenance") },
                { value: "unreachable", label: ts("unreachable") },
              ]}
            />
            <SelectMenu
              className="w-44"
              value={groupBy}
              onValueChange={(v) => setGroupBy(v as NodeGroupBy)}
              aria-label={t("groupBy")}
              options={[
                { value: "category", label: t("groupByCategory") },
                { value: "subcategory", label: t("groupBySubcategory") },
                { value: "none", label: t("groupByNone") },
              ]}
            />
            {hasFilters ? (
              <Button variant="ghost" onClick={resetFilters}>
                {t("resetFilters")}
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      {groups.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title={t("empty")}
          description={tc("adjustFilters")}
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={resetFilters}>
                {t("resetFiltersLong")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          {/* Dit une fois, au-dessus du tableau, ce que les jauges mesurent.
              Sans cette ligne on lit « 29 Go sur 35 » comme une machine pleine,
              alors qu'elle peut très bien dormir : on vend des limites, les
              clients en emploient une fraction. */}
          <p className="text-faint text-xs">{t("capacityLegend")}</p>

          {groups.map((group) => {
            const isCollapsed = collapsed[group.key] ?? false;
            const unreachable = group.nodes.filter(
              (n) => nodeStatus(n, now ?? undefined) === "unreachable",
            ).length;
            const servers = group.nodes.reduce((sum, n) => sum + n.servers, 0);

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
                      className={`size-4 shrink-0 text-muted transition-transform ${
                        isCollapsed ? "-rotate-90" : ""
                      }`}
                    />
                    <span className="font-semibold text-fg">{group.label}</span>
                    {group.parentLabel ? (
                      <span className="text-xs text-faint">{group.parentLabel}</span>
                    ) : null}
                    {/* Le nombre nu se lisait comme un rang ou un identifiant à côté
                        du titre : il dit ce qu'il compte. */}
                    <Badge variant="neutral">
                      {t("groupNodes", { count: group.nodes.length })}
                    </Badge>
                    <span className="text-muted text-xs">
                      {t("groupServers", { count: servers })}
                    </span>
                    {unreachable > 0 ? (
                      <Badge variant="danger">
                        {t("groupUnreachable", { count: unreachable })}
                      </Badge>
                    ) : null}
                  </button>
                ) : null}

                {!isCollapsed ? (
                  <DataTable columns={columns} data={group.nodes} getRowId={(row) => row.id} />
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {/* Sans stock de ports, aucun serveur ne peut être créé sur un node :
          c'est la première chose à faire après l'avoir déclaré, et l'oublier
          donne un « aucun node disponible » que rien n'explique. */}
      <Dialog open={toAllocate !== null} onOpenChange={(o) => !o && setToAllocate(null)}>
        <DialogContent
          title={t("addPorts")}
          description={toAllocate ? t("addPortsOn", { name: toAllocate.name }) : undefined}
          footer={
            <Button
              disabled={pending || ip.trim() === ""}
              onClick={() => {
                const target = toAllocate;
                setToAllocate(null);
                if (!target) return;
                startTransition(async () => {
                  const result = await addNodeAllocations(
                    target.id,
                    ip.trim(),
                    Number(from),
                    Number(to || from),
                  );
                  setError(result.error);
                  if (!result.error) router.refresh();
                });
              }}
            >
              {tc("add")}
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label={tc("ipAddress")}>
              {(id) => (
                <Input
                  id={id}
                  className="gd-mono"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  placeholder="127.0.0.1"
                />
              )}
            </FormField>
            <FormField label={t("portFrom")}>
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
        </DialogContent>
      </Dialog>

      {/*
        Attribution d'un node à un revendeur.

        C'est l'autorisation qui va dans le sens administration → revendeur :
        l'administration décide quelles machines il exploite, lui décide si
        l'administration peut provisionner chez lui. Les deux sont nécessaires,
        et aucune n'implique l'autre.
      */}
      <Dialog
        open={toAssign !== null}
        onOpenChange={(open) => {
          if (!open) setToAssign(null);
        }}
      >
        <DialogContent
          title={t("assignToReseller")}
          description={toAssign ? t("assignOn", { name: toAssign.name }) : undefined}
          footer={
            <>
              <Button variant="secondary" onClick={() => setToAssign(null)}>
                {tc("cancel")}
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  const target = toAssign;
                  setToAssign(null);
                  if (!target) return;
                  startTransition(async () => {
                    const result = await setNodeOwner(
                      target.id,
                      assignee === "platform" ? null : assignee,
                    );
                    setError(result.error);
                    if (!result.error) router.refresh();
                  });
                }}
              >
                {tc("save")}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {resellers.length === 0 ? (
              <AlertBanner variant="info">{t("noResellers")}</AlertBanner>
            ) : null}

            <FormField label={t("owner")} description={t("ownerHint")}>
              {(id) => (
                <SelectMenu
                  id={id}
                  value={assignee}
                  onValueChange={setAssignee}
                  options={[
                    { value: "platform", label: t("nodePlatform"), description: t("platformHint") },
                    ...resellers.map((reseller) => ({
                      value: reseller.id,
                      label: reseller.name,
                      // L'état de l'autorisation inverse est montré ici parce
                      // que c'est le moment où l'on s'en préoccupe : attribuer
                      // une machine à quelqu'un qui refuse qu'on y provisionne
                      // est parfaitement valable, mais mieux vaut le savoir.
                      description: platformMayProvision(reseller.platformAccess)
                        ? t("resellerAllows")
                        : t("resellerRefuses"),
                    })),
                  ]}
                />
              )}
            </FormField>

            {/* Ce que l'attribution change, dit avant de valider. */}
            <AlertBanner variant="warning">{t("assignConsequence")}</AlertBanner>
          </div>
        </DialogContent>
      </Dialog>

      {/* Monté seulement à l'ouverture : la fenêtre lit les parts et calcule
          leur consommation, ce qui n'a pas à se faire pour chaque ligne du
          tableau. */}
      {toShare ? (
        <AdminNodeShares
          node={{
            id: toShare.id,
            name: toShare.name,
            memoryMb: toShare.memoryTotalMb,
            diskMb: toShare.diskTotalMb,
            ownerId: toShare.ownerId,
          }}
          resellers={resellers}
          onClose={() => setToShare(null)}
        />
      ) : null}

      {/* Confirmation avant retrait. L'API refuse tant que des serveurs y
          tournent et dit combien : la fenêtre n'a pas à le deviner, elle
          affiche la raison rendue. */}
      <Dialog open={toRemove !== null} onOpenChange={(open) => !open && setToRemove(null)}>
        <DialogContent
          title={t("removeNodeTitle", { name: toRemove?.name ?? "" })}
          description={t("removeNodeHint")}
          footer={
            <>
              <Button variant="ghost" onClick={() => setToRemove(null)}>
                {tc("cancel")}
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    if (!toRemove) return;
                    const result = await removeNode(toRemove.id);
                    setError(result.error);
                    if (!result.error) {
                      setToRemove(null);
                      router.refresh();
                    }
                  })
                }
              >
                {t("removeNodeConfirm")}
              </Button>
            </>
          }
        >
          <p className="text-muted text-sm">{t("removeNodeBody")}</p>
        </DialogContent>
      </Dialog>

      {/* Remplacement du jeton du daemon.
          Pas destructeur, et la fenêtre le dit : le panel ne retient le nouveau
          jeton que si le daemon a confirmé le connaître. Sans cette phrase, on
          hésite à cliquer sur un bouton qui peut couper une machine. */}
      <Dialog open={toRotate !== null} onOpenChange={(open) => !open && setToRotate(null)}>
        <DialogContent
          title={t("rotateTokenTitle", { name: toRotate?.name ?? "" })}
          description={t("rotateTokenHint")}
          footer={
            <>
              <Button variant="ghost" onClick={() => setToRotate(null)}>
                {tc("cancel")}
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    if (!toRotate) return;
                    const result = await rotateNodeToken(toRotate.id);
                    setError(result.error);
                    if (result.applied) {
                      setToRotate(null);
                      router.refresh();
                    }
                  })
                }
              >
                {t("rotateTokenConfirm")}
              </Button>
            </>
          }
        >
          <p className="text-muted text-sm">{t("rotateTokenBody")}</p>
        </DialogContent>
      </Dialog>

      {toInspect ? <AdminNodeLoad node={toInspect} onClose={() => setToInspect(null)} /> : null}

      {toConfigure ? (
        <AdminNodeConfigure
          node={{ id: toConfigure.id, name: toConfigure.name }}
          panelOrigin={panelOrigin}
          onClose={() => setToConfigure(null)}
        />
      ) : null}
    </PageTemplate>
  );
}
