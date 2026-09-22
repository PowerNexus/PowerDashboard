"use client";

import {
  AlertBanner,
  Badge,
  Button,
  type ColumnDef,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogContent,
  DropdownItem,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  PageTemplate,
  RowActions,
  SelectMenu,
} from "@gamedashboard/ui";
import { Database, Pencil, Plug, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import type { AdminNode } from "@/server/api/admin";
import {
  type DatabaseHost,
  type DatabaseHostForm,
  deleteDatabaseHost,
  saveDatabaseHost,
  testDatabaseHost,
} from "@/server/api/database-hosts";

/**
 * Hôtes MySQL sur lesquels le panel crée les bases des clients.
 *
 * Tant qu'aucun n'est déclaré, la page « bases de données » d'un serveur
 * fonctionne mais refuse toute création : c'est cet écran qui met la
 * fonctionnalité en service, et le bandeau le dit plutôt que de laisser
 * découvrir la panne côté client.
 */
export function DatabaseHostsWorkspace({
  hosts,
  nodes,
}: {
  hosts: DatabaseHost[];
  nodes: AdminNode[];
}) {
  const t = useTranslations("databaseHosts");
  const tc = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DatabaseHost | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<DatabaseHost | null>(null);
  const [pending, startTransition] = useTransition();

  const columns = useMemo<ColumnDef<DatabaseHost, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columnHost"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-semibold text-fg">{row.original.name}</p>
            <p className="gd-mono text-muted text-xs">
              {row.original.username}@{row.original.host}:{row.original.port}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "nodeName",
        header: t("columnScope"),
        cell: ({ row }) =>
          // « Toute la plateforme » est le cas ordinaire ; un hôte réservé à un
          // node l'est quand la base tourne sur la même machine que les jeux.
          row.original.nodeName ? (
            <Badge variant="info">{row.original.nodeName}</Badge>
          ) : (
            <span className="text-muted text-sm">{t("everywhere")}</span>
          ),
      },
      {
        accessorKey: "databases",
        header: t("columnDatabases"),
        cell: ({ row }) => (
          <span className="text-muted text-sm">
            {row.original.maxDatabases === null
              ? row.original.databases
              : `${row.original.databases} / ${row.original.maxDatabases}`}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        size: 60,
        cell: ({ row }) => (
          <RowActions>
            <DropdownItem icon={<Pencil />} onSelect={() => setEditing(row.original)}>
              {tc("edit")}
            </DropdownItem>
            <DropdownItem
              icon={<Trash2 />}
              destructive
              // Un hôte qui porte des bases ne se retire pas : l'API refuse, et
              // le dire ici évite un clic qui ne peut qu'échouer.
              disabled={row.original.databases > 0 || pending}
              onSelect={() => setToDelete(row.original)}
            >
              {tc("delete")}
            </DropdownItem>
          </RowActions>
        ),
      },
    ],
    [t, tc, pending],
  );

  return (
    <PageTemplate
      header={
        <PageHeader
          icon={<Database />}
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <Button disabled={pending} onClick={() => setCreating(true)}>
              <Plus /> {t("declare")}
            </Button>
          }
        />
      }
    >
      {error ? (
        <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      {/* Dit pourquoi une fonctionnalité de l'espace client ne marche pas, là
          où la décision se prend. Le client, lui, ne verrait qu'un refus. */}
      {hosts.length === 0 ? (
        <AlertBanner variant="warning" title={t("noneTitle")}>
          {t("noneBody")}
        </AlertBanner>
      ) : null}

      <DataTable
        columns={columns}
        data={hosts}
        getRowId={(row) => row.id}
        emptyState={
          <EmptyState
            icon={<Database />}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus /> {t("declare")}
              </Button>
            }
          />
        }
      />

      <HostDialog
        open={creating || editing !== null}
        host={editing}
        nodes={nodes}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          router.refresh();
        }}
        onError={setError}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t("deleteTitle")}
        description={t("deleteBody", { name: toDelete?.name ?? "" })}
        confirmLabel={tc("delete")}
        destructive
        onConfirm={() => {
          const target = toDelete;
          setToDelete(null);
          if (!target) return;
          startTransition(async () => {
            const result = await deleteDatabaseHost(target.id);
            setError(result.error);
            if (!result.error) router.refresh();
          });
        }}
      />
    </PageTemplate>
  );
}

/**
 * Formulaire de déclaration.
 *
 * Le bouton « tester » n'est pas un ornement : l'API refuse d'enregistrer un
 * hôte dont les identifiants n'ont pas répondu. Le test permet de le vérifier
 * avant, et de distinguer « injoignable » de « refusé » — deux pannes qui ne se
 * corrigent pas au même endroit.
 */
function HostDialog({
  open,
  host,
  nodes,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  host: DatabaseHost | null;
  nodes: AdminNode[];
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string | null) => void;
}) {
  const t = useTranslations("databaseHosts");
  const tc = useTranslations("common");
  const [form, setForm] = useState<DatabaseHostForm>(blank());
  const [probe, setProbe] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Le formulaire se recharge quand on ouvre une autre ligne. Comparer
  // l'identifiant plutôt qu'un effet : l'état suit la ligne éditée, sans
  // rendu supplémentaire.
  const key = host?.id ?? "nouveau";
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setProbe(null);
    setForm(
      host
        ? {
            name: host.name,
            host: host.host,
            port: host.port,
            username: host.username,
            // Jamais pré-rempli : le panel ne relit pas un mot de passe. Vide
            // veut dire « ne change rien ».
            password: "",
            nodeId: host.nodeId,
            maxDatabases: host.maxDatabases,
          }
        : blank(),
    );
  }

  const set = <K extends keyof DatabaseHostForm>(field: K, value: DatabaseHostForm[K]) =>
    setForm((current) => ({ ...current, [field]: value }));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setLoadedFor(null);
          onClose();
        }
      }}
    >
      <DialogContent title={host ? t("editTitle") : t("declareTitle")}>
        <div className="flex flex-col gap-4">
          <FormField label={t("name")} description={t("nameHint")}>
            {(id) => (
              <Input id={id} value={form.name} onChange={(e) => set("name", e.target.value)} />
            )}
          </FormField>

          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <FormField label={t("address")}>
              {(id) => (
                <Input id={id} value={form.host} onChange={(e) => set("host", e.target.value)} />
              )}
            </FormField>
            <FormField label={t("port")}>
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  value={String(form.port)}
                  onChange={(e) => set("port", Number(e.target.value) || 0)}
                />
              )}
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("username")} description={t("usernameHint")}>
              {(id) => (
                <Input
                  id={id}
                  value={form.username}
                  onChange={(e) => set("username", e.target.value)}
                />
              )}
            </FormField>
            <FormField
              label={tc("password")}
              description={host ? t("passwordKeepHint") : undefined}
            >
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                />
              )}
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("scope")} description={t("scopeHint")}>
              {(id) => (
                <SelectMenu
                  id={id}
                  value={form.nodeId ?? ""}
                  onValueChange={(value) => set("nodeId", value === "" ? null : value)}
                  options={[
                    { value: "", label: t("everywhere") },
                    ...nodes.map((node) => ({ value: node.id, label: node.name })),
                  ]}
                />
              )}
            </FormField>
            <FormField label={t("maxDatabases")} description={t("maxDatabasesHint")}>
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  value={form.maxDatabases === null ? "" : String(form.maxDatabases)}
                  onChange={(e) =>
                    set("maxDatabases", e.target.value === "" ? null : Number(e.target.value) || 0)
                  }
                />
              )}
            </FormField>
          </div>

          {probe ? <AlertBanner variant="info">{probe}</AlertBanner> : null}

          <div className="flex flex-wrap justify-end gap-3">
            <Button
              variant="secondary"
              disabled={pending || form.password === ""}
              onClick={() =>
                startTransition(async () => {
                  const result = await testDatabaseHost(form);
                  if ("error" in result) {
                    setProbe(null);
                    onError(result.error);
                    return;
                  }
                  onError(null);
                  setProbe(
                    result.canCreate
                      ? t("probeOk", { version: result.version })
                      : t("probeNoGrant", { version: result.version }),
                  );
                })
              }
            >
              <Plug /> {t("test")}
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await saveDatabaseHost(form, host?.id);
                  onError(result.error);
                  if (!result.error) {
                    setLoadedFor(null);
                    onSaved();
                  }
                })
              }
            >
              {tc("save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function blank(): DatabaseHostForm {
  return {
    name: "",
    host: "",
    port: 3306,
    username: "",
    password: "",
    nodeId: null,
    maxDatabases: null,
  };
}
