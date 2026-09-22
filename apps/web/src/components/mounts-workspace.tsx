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
  SettingToggle,
} from "@gamedashboard/ui";
import { FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { deleteMount, type Mount, type MountForm, saveMount } from "@/server/api/mounts";

/**
 * Dossiers de la machine hôte partagés avec des conteneurs.
 *
 * L'écran dit ce que le panel peut et ce qu'il ne peut pas : il décide quels
 * montages existent, mais le daemon refuse tout dossier qui ne figure pas dans
 * son propre `allowed_mounts`. Un administrateur qui déclare ici un montage
 * refusé côté machine chercherait longtemps pourquoi il n'apparaît pas — le
 * bandeau le lui dit d'emblée.
 */
export function MountsWorkspace({ mounts }: { mounts: Mount[] }) {
  const t = useTranslations("mounts");
  const tc = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Mount | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<Mount | null>(null);
  const [pending, startTransition] = useTransition();

  const columns = useMemo<ColumnDef<Mount, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columnMount"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-semibold text-fg">{row.original.name}</p>
            <p className="gd-mono truncate text-muted text-xs">
              {row.original.source} → {row.original.target}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "readOnly",
        header: t("columnAccess"),
        cell: ({ row }) =>
          row.original.readOnly ? (
            <Badge variant="neutral">{t("readOnly")}</Badge>
          ) : (
            // L'écriture se signale : le serveur peut alors modifier ce que ses
            // voisins lisent.
            <Badge variant="warning">{t("writable")}</Badge>
          ),
      },
      {
        accessorKey: "userMountable",
        header: t("columnWhoAttaches"),
        cell: ({ row }) => (
          <span className="text-muted text-sm">
            {row.original.userMountable ? t("clientMay") : t("adminOnly")}
          </span>
        ),
      },
      {
        accessorKey: "servers",
        header: t("columnServers"),
        cell: ({ getValue }) => <span className="text-muted text-sm">{getValue() as number}</span>,
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
              // Un montage attaché ne se supprime pas : l'API refuse, et le
              // dire ici évite un clic qui ne peut qu'échouer.
              disabled={row.original.servers > 0 || pending}
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
          icon={<FolderTree />}
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

      {/* La seconde barrière, celle que le panel ne tient pas. */}
      <AlertBanner variant="info" title={t("allowedTitle")}>
        {t("allowedBody")}
      </AlertBanner>

      <DataTable
        columns={columns}
        data={mounts}
        getRowId={(row) => row.id}
        emptyState={
          <EmptyState
            icon={<FolderTree />}
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

      <MountDialog
        open={creating || editing !== null}
        mount={editing}
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
            const result = await deleteMount(target.id);
            setError(result.error);
            if (!result.error) router.refresh();
          });
        }}
      />
    </PageTemplate>
  );
}

function MountDialog({
  open,
  mount,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  mount: Mount | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string | null) => void;
}) {
  const t = useTranslations("mounts");
  const tc = useTranslations("common");
  const [form, setForm] = useState<MountForm>(blank());
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const key = mount?.id ?? "nouveau";
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setForm(mount ? { ...mount } : blank());
  }

  const set = <K extends keyof MountForm>(field: K, value: MountForm[K]) =>
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
      <DialogContent title={mount ? t("editTitle") : t("declareTitle")}>
        <div className="flex flex-col gap-4">
          <FormField label={t("name")} description={t("nameHint")}>
            {(id) => (
              <Input id={id} value={form.name} onChange={(e) => set("name", e.target.value)} />
            )}
          </FormField>

          <FormField label={t("source")} description={t("sourceHint")}>
            {(id) => (
              <Input
                id={id}
                className="gd-mono text-xs"
                placeholder="/srv/partage/cartes"
                value={form.source}
                onChange={(e) => set("source", e.target.value)}
              />
            )}
          </FormField>

          <FormField label={t("target")} description={t("targetHint")}>
            {(id) => (
              <Input
                id={id}
                className="gd-mono text-xs"
                placeholder="/home/container/cartes"
                value={form.target}
                onChange={(e) => set("target", e.target.value)}
              />
            )}
          </FormField>

          <div className="divide-y divide-border">
            <SettingToggle
              label={t("readOnlyLabel")}
              description={t("readOnlyHint")}
              checked={form.readOnly}
              onCheckedChange={(value) => set("readOnly", value)}
            />
            <SettingToggle
              label={t("userMountableLabel")}
              description={t("userMountableHint")}
              checked={form.userMountable}
              onCheckedChange={(value) => set("userMountable", value)}
            />
          </div>

          <div className="flex justify-end">
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await saveMount(form, mount?.id);
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

function blank(): MountForm {
  return {
    name: "",
    source: "",
    target: "",
    // Lecture seule par défaut : l'écriture se demande, elle ne s'hérite pas
    // d'un champ qu'on n'a pas regardé.
    readOnly: true,
    userMountable: false,
  };
}
