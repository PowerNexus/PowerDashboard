"use client";

import { PLATFORM_ACCESS_META, quotaOutlook } from "@gamedashboard/contracts";
import {
  AlertBanner,
  Avatar,
  Badge,
  Button,
  type ColumnDef,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogContent,
  DropdownItem,
  DropdownSeparator,
  EmptyState,
  FormField,
  formatMb,
  Input,
  PageHeader,
  PageTemplate,
  RelativeTime,
  RowActions,
  SelectMenu,
} from "@gamedashboard/ui";
import { Eye, Gauge, KeyRound, Search, Trash2, UserCog, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState, useTransition } from "react";
import type { AdminUser } from "@/server/api/admin";
import {
  deleteUser,
  fetchResellerQuotaReport,
  revokeUserSessions,
  setResellerQuota,
  setUserRole,
} from "@/server/api/admin-actions";
import type { ResellerQuotaReport } from "@/server/api/reseller";
import { impersonate } from "@/server/api/session";
import { AdminUserCreate } from "./admin-user-create";

/**
 * Un champ vide vaut « sans limite », pas zéro.
 *
 * `Number("")` rend 0, qui dirait l'inverse exact : plus aucune création. La
 * conversion passe donc par une comparaison explicite, et tout ce qui n'est
 * pas un entier positif est traité comme « rien saisi » plutôt que d'envoyer
 * un `NaN` que l'API refuserait sans expliquer pourquoi.
 */
function optionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/** Le libellé vient du catalogue ; seule la couleur reste ici. */
const ROLE_TONE: Record<AdminUser["role"], "danger" | "info" | "accent" | "neutral"> = {
  admin: "danger",
  support: "info",
  reseller: "accent",
  user: "neutral",
};

export function AdminUsers({ initial }: { initial: AdminUser[] }) {
  const t = useTranslations("adminUsers");
  const tc = useTranslations("common");
  const tr = useTranslations("role");
  const router = useRouter();
  const users = initial;
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [toDelete, setToDelete] = useState<AdminUser | null>(null);
  /**
   * Le revendeur dont on modifie l'enveloppe, et les trois champs en cours.
   *
   * Les champs sont des chaînes, pas des nombres : le vide est une valeur qui
   * a un sens ici — « sans limite » — et `Number("")` vaut zéro, qui veut dire
   * l'inverse exact. Les garder en texte rend cette distinction impossible à
   * perdre en chemin.
   */
  const [toQuota, setToQuota] = useState<AdminUser | null>(null);
  const [quotaMemory, setQuotaMemory] = useState("");
  const [quotaDisk, setQuotaDisk] = useState("");
  const [quotaServers, setQuotaServers] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * La liste vient du serveur et n'y est jamais modifiée en mémoire : un compte
   * qu'on croirait supprimé alors que l'API a refusé réapparaîtrait au
   * rechargement suivant, et l'écran ne voudrait plus rien dire.
   */
  const run = useCallback(
    (action: () => Promise<{ error: string | null }>, label: string) =>
      startTransition(async () => {
        const result = await action();
        setError(result.error);
        setNotice(result.error ? null : label);
        if (!result.error) router.refresh();
      }),
    [router],
  );

  /**
   * Ce que le revendeur consomme, au moment où l'on regarde son enveloppe.
   *
   * `null` tant qu'elle n'est pas arrivée : l'écran ne doit pas prétendre
   * qu'il n'y a aucun dépassement pendant qu'il l'ignore encore.
   */
  const [quotaReport, setQuotaReport] = useState<ResellerQuotaReport | null>(null);

  /** Ouvre le formulaire pré-rempli de l'enveloppe en place. */
  const openQuota = useCallback((user: AdminUser) => {
    // `??` et non `||` : un plafond posé à zéro doit s'afficher « 0 », pas
    // devenir un champ vide qui se lirait « sans limite ».
    setQuotaMemory(user.quotaMemoryMb?.toString() ?? "");
    setQuotaDisk(user.quotaDiskMb?.toString() ?? "");
    setQuotaServers(user.quotaServersMax?.toString() ?? "");
    setQuotaReport(null);
    setToQuota(user);
    // La consommation arrive après l'ouverture : attendre pour afficher le
    // formulaire ferait payer un aller-retour à qui vient seulement lire
    // l'enveloppe en place.
    void fetchResellerQuotaReport(user.id)
      .then(setQuotaReport)
      .catch(() => setQuotaReport(null));
  }, []);

  /**
   * Ce que le chiffre saisi va provoquer, s'il est enregistré.
   *
   * La règle est celle du surveillant, pas une seconde lecture : on lui donne
   * l'enveloppe telle qu'elle serait et la consommation telle qu'elle est, et
   * il répond ce qu'il ferait. Abaisser une enveloppe de mémoire sous la
   * consommation mesurée **arrête des serveurs de clients** dans les minutes
   * qui suivent — un champ de formulaire n'a pas le droit de faire cela sans
   * le dire.
   */
  const apercu = useMemo(() => {
    if (quotaReport === null) return null;
    return quotaOutlook(
      {
        memoryMb: optionalInt(quotaMemory),
        diskMb: optionalInt(quotaDisk),
        serversMax: optionalInt(quotaServers),
      },
      quotaReport.usage,
      quotaReport.usage.basis,
    );
  }, [quotaReport, quotaMemory, quotaDisk, quotaServers]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return users.filter(
      (u) =>
        (role === "all" || u.role === role) &&
        (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
    );
  }, [users, query, role]);

  const columns = useMemo<ColumnDef<AdminUser, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columnUser"),
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar name={row.original.name} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-fg">{row.original.name}</p>
              <p className="truncate text-xs text-muted">{row.original.email}</p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "role",
        header: t("columnRole"),
        cell: ({ row }) => {
          return <Badge variant={ROLE_TONE[row.original.role]}>{tr(row.original.role)}</Badge>;
        },
      },
      {
        accessorKey: "servers",
        header: t("columnServers"),
        cell: ({ getValue }) => <span className="text-fg">{getValue() as number}</span>,
      },
      {
        id: "provisioning",
        header: t("columnProvisioning"),
        cell: ({ row }) =>
          // La question ne se pose que pour un revendeur : ailleurs la colonne
          // resterait vide, ce qui se lirait comme « non » alors que la notion
          // n'existe pas.
          row.original.role !== "reseller" ? (
            <span className="text-faint">{tc("none")}</span>
          ) : (
            /*
             * Le niveau, et non « autorisé / refusé ».
             *
             * La colonne disait oui ou non sur la seule création, alors que
             * l'administration gardait la console, les fichiers et la
             * suppression. Un administrateur y lisait « refusé » et gardait
             * malgré tout tous les droits — le tableau le rassurait sur une
             * limite qui n'existait pas.
             *
             * Le ton suit ce que la plateforme peut encore faire : ce n'est
             * pas une gravité, c'est une capacité.
             */
            <Badge
              variant={
                row.original.platformAccess === "provision"
                  ? "success"
                  : row.original.platformAccess === "read_only"
                    ? "neutral"
                    : "warning"
              }
            >
              {PLATFORM_ACCESS_META[row.original.platformAccess].label}
            </Badge>
          ),
      },
      {
        id: "quota",
        header: t("columnQuota"),
        cell: ({ row }) => {
          if (row.original.role !== "reseller") {
            return <span className="text-faint">{tc("none")}</span>;
          }

          const parts = [
            row.original.quotaMemoryMb === null ? null : formatMb(row.original.quotaMemoryMb, 0),
            row.original.quotaServersMax === null
              ? null
              : t("quotaServersShort", { count: row.original.quotaServersMax }),
          ].filter((part): part is string => part !== null);

          // Aucune borne posée : « sans limite » plutôt qu'une case vide, qui
          // se lirait comme « rien d'autorisé ».
          return parts.length === 0 ? (
            <span className="text-muted text-xs">{t("quotaUnlimited")}</span>
          ) : (
            <span className="gd-mono text-fg text-xs">{parts.join(" · ")}</span>
          );
        },
      },
      {
        accessorKey: "is2faEnabled",
        header: t("columnTwoFactor"),
        cell: ({ getValue }) =>
          (getValue() as boolean) ? (
            <Badge variant="success">{t("twoFactorOn")}</Badge>
          ) : (
            <Badge variant="warning">{t("twoFactorOff")}</Badge>
          ),
      },
      {
        accessorKey: "lastLoginAt",
        header: t("columnLastLogin"),
        cell: ({ getValue }) => (
          <RelativeTime className="text-muted" value={getValue() as string} />
        ),
      },
      {
        id: "actions",
        header: "",
        size: 60,
        cell: ({ row }) => (
          <RowActions>
            {/* Les rôles attribuables sont ceux que l'API accepte ; « owner »
                n'en est pas, il n'existe qu'à l'installation. */}
            {(["user", "reseller", "support", "admin"] as const)
              .filter((next) => next !== row.original.role)
              .map((next) => (
                <DropdownItem
                  key={next}
                  icon={<UserCog />}
                  disabled={pending}
                  onSelect={() =>
                    run(
                      () => setUserRole(row.original.id, next),
                      t("roleChanged", { role: tr(next) }),
                    )
                  }
                >
                  {t("switchTo", { role: tr(next) })}
                </DropdownItem>
              ))}
            <DropdownSeparator />
            {/* L'enveloppe n'existe que pour un revendeur : la proposer
                ailleurs ouvrirait un formulaire que l'API refuse. */}
            {row.original.role === "reseller" ? (
              <DropdownItem
                icon={<Gauge />}
                disabled={pending}
                onSelect={() => openQuota(row.original)}
              >
                {t("editQuota")}
              </DropdownItem>
            ) : null}
            {/* Réservée aux comptes clients : l'API refuse un membre du
                personnel, et proposer l'entrée ferait découvrir le refus
                après coup. */}
            {row.original.role === "admin" || row.original.role === "support" ? null : (
              <DropdownItem
                icon={<Eye />}
                disabled={pending}
                onSelect={() =>
                  startTransition(async () => {
                    const result = await impersonate(row.original.id);
                    if (result.error) {
                      setError(result.error);
                      return;
                    }
                    // Rechargement complet : le compte change, donc le rôle, la
                    // navigation et tout ce que le serveur avait déjà rendu.
                    window.location.href = "/";
                  })
                }
              >
                {t("impersonate")}
              </DropdownItem>
            )}
            <DropdownItem
              icon={<KeyRound />}
              disabled={pending}
              onSelect={() => run(() => revokeUserSessions(row.original.id), t("sessionsRevoked"))}
            >
              {t("revokeSessions")}
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem
              icon={<Trash2 />}
              destructive
              disabled={row.original.servers > 0}
              onSelect={() => setToDelete(row.original)}
            >
              {t("deleteAccount")}
            </DropdownItem>
          </RowActions>
        ),
      },
    ],
    [pending, run, openQuota, t, tr, tc],
  );

  return (
    <PageTemplate
      header={
        <PageHeader
          icon={<Users />}
          title={t("title")}
          subtitle={t("subtitle", { shown: filtered.length, total: users.length })}
          // La création est possible depuis ici parce que le mot de passe est
          // **tiré au sort** et non saisi : l'objection qui la tenait écartée
          // — choisir un secret à la place de quelqu'un d'autre — ne tient
          // plus. Reste l'inscription publique et le SSO, qui n'en sont pas
          // empêchés.
          actions={<AdminUserCreate />}
        />
      }
      toolbar={
        <div className="flex flex-wrap gap-3">
          <Input
            className="min-w-64 flex-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            leadingIcon={<Search />}
          />
          <SelectMenu
            className="w-56"
            value={role}
            onValueChange={setRole}
            aria-label={t("filterRole")}
            options={[
              { value: "all", label: t("allRoles") },
              { value: "admin", label: tr("admin") },
              { value: "support", label: tr("support") },
              { value: "reseller", label: tr("reseller") },
              { value: "user", label: tr("user") },
            ]}
          />
        </div>
      }
    >
      {error ? (
        <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}
      {notice ? (
        <AlertBanner variant="success" title={tc("done")} dismissible>
          {notice}
        </AlertBanner>
      ) : null}

      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(row) => row.id}
        emptyState={<EmptyState icon={<Search />} title={t("empty")} />}
      />

      {/*
        L'enveloppe d'un revendeur.

        Elle est **globale** : elle compte tout ce qu'il fait tourner, ses
        propres machines comprises. Un revendeur avec 64 Go de matériel et
        32 Go d'enveloppe n'en exploite que la moitié — c'est le principe, pas
        un effet de bord, et l'écran le dit pour qu'on ne pose pas un chiffre
        en croyant qu'il s'ajoute au matériel.
      */}
      <Dialog open={toQuota !== null} onOpenChange={(o) => !o && setToQuota(null)}>
        <DialogContent
          title={t("quotaTitle")}
          description={toQuota ? t("quotaOn", { name: toQuota.name }) : undefined}
          footer={
            <Button
              disabled={pending}
              onClick={() => {
                const target = toQuota;
                setToQuota(null);
                if (!target) return;
                run(
                  () =>
                    setResellerQuota(target.id, {
                      memoryMb: optionalInt(quotaMemory),
                      diskMb: optionalInt(quotaDisk),
                      serversMax: optionalInt(quotaServers),
                    }),
                  t("quotaSaved"),
                );
              }}
            >
              {tc("save")}
            </Button>
          }
        >
          <AlertBanner variant="info">{t("quotaNotice")}</AlertBanner>

          {quotaReport !== null ? (
            <p className="mt-3 text-muted text-xs">
              {t("quotaCurrentUsage", {
                memory: formatMb(quotaReport.usage.memoryMb, 0),
                disk: formatMb(quotaReport.usage.diskMb, 0),
                servers: quotaReport.usage.servers,
              })}
              {quotaReport.usage.basis !== "measured"
                ? ` ${t("quotaUsageEstimated", { count: quotaReport.usage.unmeasured })}`
                : null}
            </p>
          ) : null}

          {/* Le seul avertissement qui annonce une conséquence subie par des
              tiers : les serveurs arrêtés sont ceux de ses clients. */}
          {apercu === "over-enforced" ? (
            <AlertBanner variant="danger" className="mt-3">
              {t("quotaWillStop")}
            </AlertBanner>
          ) : null}
          {apercu === "over-passive" ? (
            <AlertBanner variant="warning" className="mt-3">
              {t("quotaWillBlock")}
            </AlertBanner>
          ) : null}
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <FormField label={t("quotaMemory")} description={t("quotaEmptyHint")}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  className="gd-mono"
                  value={quotaMemory}
                  onChange={(e) => setQuotaMemory(e.target.value)}
                  placeholder={t("quotaUnlimited")}
                />
              )}
            </FormField>
            <FormField label={t("quotaDisk")} description={t("quotaEmptyHint")}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  className="gd-mono"
                  value={quotaDisk}
                  onChange={(e) => setQuotaDisk(e.target.value)}
                  placeholder={t("quotaUnlimited")}
                />
              )}
            </FormField>
            <FormField label={t("quotaServersLabel")} description={t("quotaEmptyHint")}>
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  className="gd-mono"
                  value={quotaServers}
                  onChange={(e) => setQuotaServers(e.target.value)}
                  placeholder={t("quotaUnlimited")}
                />
              )}
            </FormField>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t("deleteTitle")}
        description={t("deleteBody")}
        confirmLabel={tc("delete")}
        destructive
        requireTyped={toDelete?.email}
        onConfirm={() => {
          const target = toDelete;
          setToDelete(null);
          if (target) run(() => deleteUser(target.id), t("accountDeleted"));
        }}
      />
    </PageTemplate>
  );
}
