"use client";

import {
  AlertBanner,
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  Dialog,
  DialogContent,
  DropdownItem,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  PageTemplate,
  RelativeTime,
  RowActions,
  Select,
} from "@gamedashboard/ui";
import { Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import {
  type Announcement,
  deleteAnnouncement,
  saveAnnouncement,
} from "@/server/api/announcements";

/** Rôles auxquels une annonce peut s'adresser. Vide = tout le monde. */
const ROLES = ["user", "reseller", "support", "admin"] as const;

const EMPTY: Partial<Announcement> = {
  title: "",
  bodyMd: "",
  level: "info",
  audience: [],
  endsAt: null,
};

/**
 * Annonces de la plateforme.
 *
 * Distinctes des incidents, qui vivent sur la page d'état : un incident est
 * subi et public, une annonce est décidée et s'adresse à des gens connectés.
 * Les confondre ferait passer une maintenance planifiée pour une panne.
 */
export function AnnouncementsWorkspace({ announcements }: { announcements: Announcement[] }) {
  const t = useTranslations("announcements");
  const tc = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Announcement> | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      if (!draft) return;
      const result = await saveAnnouncement(draft);
      setError(result.error);
      if (!result.error) {
        setDraft(null);
        router.refresh();
      }
    });

  const remove = (id: string) =>
    startTransition(async () => {
      const result = await deleteAnnouncement(id);
      setError(result.error);
      if (!result.error) router.refresh();
    });

  const columns = useMemo<ColumnDef<Announcement, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: t("columnAnnouncement"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-semibold text-fg">{row.original.title}</p>
            <p className="truncate text-muted text-xs">{row.original.bodyMd}</p>
          </div>
        ),
      },
      {
        accessorKey: "level",
        header: t("columnLevel"),
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.level === "critical"
                ? "danger"
                : row.original.level === "warning"
                  ? "warning"
                  : "info"
            }
          >
            {t(`level.${row.original.level}`)}
          </Badge>
        ),
      },
      {
        accessorKey: "audience",
        header: t("columnAudience"),
        cell: ({ row }) =>
          // « Tout le monde » plutôt qu'un tiret : un public vide n'est pas un
          // public manquant, c'est le cas le plus courant.
          row.original.audience.length === 0 ? (
            <span className="text-muted">{t("everyone")}</span>
          ) : (
            <span className="text-fg text-xs">
              {row.original.audience.map((role) => t(`role.${role}`)).join(", ")}
            </span>
          ),
      },
      {
        accessorKey: "endsAt",
        header: t("columnWindow"),
        cell: ({ row }) => (
          <span className="text-muted text-xs">
            <RelativeTime value={row.original.startsAt} />
            {row.original.endsAt ? (
              <>
                {" → "}
                <RelativeTime value={row.original.endsAt} />
              </>
            ) : (
              // Sans fin annoncée : dit explicitement, sinon on cherche une
              // date qu'on croit avoir oublié de poser.
              <> — {t("noEnd")}</>
            )}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <RowActions>
            <DropdownItem icon={<Pencil />} onSelect={() => setDraft(row.original)}>
              {tc("edit")}
            </DropdownItem>
            <DropdownItem icon={<Trash2 />} destructive onSelect={() => remove(row.original.id)}>
              {tc("delete")}
            </DropdownItem>
          </RowActions>
        ),
      },
    ],
    [t, tc, remove],
  );

  return (
    <PageTemplate
      header={
        <PageHeader
          icon={<Megaphone />}
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <Button onClick={() => setDraft({ ...EMPTY })}>
              <Plus /> {t("create")}
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

      <DataTable
        columns={columns}
        data={announcements}
        getRowId={(row) => row.id}
        emptyState={
          <EmptyState icon={<Megaphone />} title={t("emptyTitle")} description={t("emptyBody")} />
        }
      />

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent
          size="lg"
          title={draft?.id ? t("editTitle") : t("create")}
          description={t("formHint")}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                {tc("cancel")}
              </Button>
              <Button loading={pending} onClick={submit}>
                {tc("save")}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <FormField label={t("fieldTitle")}>
              {(id) => (
                <Input
                  id={id}
                  value={draft?.title ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                />
              )}
            </FormField>

            <FormField label={t("fieldBody")} description={t("fieldBodyHint")}>
              {(id) => (
                <textarea
                  id={id}
                  rows={4}
                  value={draft?.bodyMd ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, bodyMd: e.target.value }))}
                  className="w-full resize-y rounded-field border border-border bg-surface px-3 py-2 text-fg text-sm outline-none focus:border-accent"
                />
              )}
            </FormField>

            <FormField label={t("fieldLevel")}>
              {(id) => (
                <Select
                  id={id}
                  value={draft?.level ?? "info"}
                  options={[
                    { value: "info", label: t("level.info") },
                    { value: "warning", label: t("level.warning") },
                    { value: "critical", label: t("level.critical") },
                  ]}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, level: e.target.value as Announcement["level"] }))
                  }
                />
              )}
            </FormField>

            <FormField label={t("fieldAudience")} description={t("fieldAudienceHint")}>
              {() => (
                <div className="flex flex-wrap gap-3">
                  {ROLES.map((role) => (
                    <label key={role} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-accent"
                        checked={draft?.audience?.includes(role) ?? false}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            audience: e.target.checked
                              ? [...(d?.audience ?? []), role]
                              : (d?.audience ?? []).filter((r) => r !== role),
                          }))
                        }
                      />
                      {t(`role.${role}`)}
                    </label>
                  ))}
                </div>
              )}
            </FormField>

            <FormField label={t("fieldEnd")} description={t("fieldEndHint")}>
              {(id) => (
                <Input
                  id={id}
                  type="datetime-local"
                  value={toLocalInput(draft?.endsAt ?? null)}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      // Champ vidé : l'annonce n'a pas de fin, et `null` le dit
                      // mieux qu'une chaîne vide que l'API devrait deviner.
                      endsAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                    }))
                  }
                />
              )}
            </FormField>
          </div>
        </DialogContent>
      </Dialog>
    </PageTemplate>
  );
}

/**
 * Convertit une date ISO pour un `datetime-local`, qui n'accepte que l'heure
 * locale sans fuseau. Le décalage est retiré à la main : `toISOString` rendrait
 * l'heure UTC, et le champ afficherait deux heures d'écart en été.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
