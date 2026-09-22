"use client";

import { cronToString } from "@gamedashboard/contracts";
import {
  AlertBanner,
  Badge,
  Button,
  type ColumnDef,
  ConfirmDialog,
  CronBuilder,
  type CronValue,
  DataTable,
  Dialog,
  DialogContent,
  DropdownItem,
  DropdownSeparator,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  PageTemplate,
  RelativeTime,
  RowActions,
  SelectMenu,
  SettingToggle,
  Switch,
} from "@gamedashboard/ui";
import { Calendar, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState, useTransition } from "react";
import {
  createSchedule,
  deleteSchedule,
  runScheduleNow,
  type Schedule,
  type ScheduleAction,
  type ScheduleTask,
  setScheduleActive,
  updateSchedule,
} from "@/server/api/schedules";

/** Actions que le planificateur sait exécuter. Le reste n'est pas proposé. */
const ACTIONS: { value: ScheduleAction; key: string }[] = [
  { value: "command", key: "actionCommand" },
  { value: "power", key: "actionPower" },
  { value: "backup", key: "actionBackup" },
];

/**
 * Étape en cours d'édition.
 *
 * `key` n'est jamais envoyée à l'API : elle ne sert qu'à identifier la ligne
 * pendant l'édition. L'index ne conviendrait pas — réordonner ou retirer une
 * étape ferait que React réutiliserait l'état d'une autre, et le contenu d'un
 * champ sauterait d'une ligne à la suivante.
 */
type DraftTask = ScheduleTask & { key: string };

const emptyTask = (): DraftTask => ({
  key: crypto.randomUUID(),
  action: "command",
  payload: "",
  timeOffset: 0,
  continueOnFailure: false,
});

/**
 * Tâches planifiées.
 *
 * Les échéances affichées viennent du planificateur, pas d'un calcul de
 * l'interface : ce qui compte est le moment où la tâche partira réellement,
 * et une date recalculée à l'écran finirait par ne plus correspondre.
 */
export function SchedulesWorkspace({
  serverId,
  initial,
}: {
  serverId: string;
  initial: Schedule[];
}) {
  const t = useTranslations("schedules");
  const tc = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Schedule | null>(null);
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const [name, setName] = useState("");
  const [cron, setCron] = useState<CronValue>({
    minute: "0",
    hour: "4",
    dayOfMonth: "*",
    month: "*",
    dayOfWeek: "*",
  });
  const [onlyWhenOnline, setOnlyWhenOnline] = useState(true);
  const [tasks, setTasks] = useState<DraftTask[]>([emptyTask()]);
  const [pending, startTransition] = useTransition();

  const run = useCallback(
    (action: () => Promise<{ error: string | null }>, onDone?: () => void) =>
      startTransition(async () => {
        const result = await action();
        setError(result.error);
        if (!result.error) {
          onDone?.();
          router.refresh();
        }
      }),
    [router],
  );

  const open = useCallback((schedule: Schedule | "new") => {
    if (schedule === "new") {
      setName("");
      setCron({ minute: "0", hour: "4", dayOfMonth: "*", month: "*", dayOfWeek: "*" });
      setOnlyWhenOnline(true);
      setTasks([emptyTask()]);
    } else {
      setName(schedule.name);
      setCron(schedule.cron);
      setOnlyWhenOnline(schedule.onlyWhenOnline);
      setTasks(
        schedule.tasks.length > 0
          ? schedule.tasks.map((t) => ({ ...t, key: t.id ?? crypto.randomUUID() }))
          : [emptyTask()],
      );
    }
    setEditing(schedule);
  }, []);

  const columns = useMemo<ColumnDef<Schedule, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columnTask"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-semibold text-fg">{row.original.name}</p>
            <p className="gd-mono text-xs text-muted">{cronToString(row.original.cron)}</p>
          </div>
        ),
      },
      {
        id: "tasks",
        header: t("columnSteps"),
        cell: ({ row }) => (
          <span className="text-muted">{t("stepCount", { count: row.original.tasks.length })}</span>
        ),
      },
      {
        accessorKey: "lastRunAt",
        header: t("columnLastRun"),
        cell: ({ row }) => {
          const at = row.original.lastRunAt;
          if (!at) return <span className="text-muted">{tc("never")}</span>;

          /*
           * L'échec prend la place de la date, et la porte en infobulle.
           *
           * Une exécution ratée affichée comme les autres — « il y a 2 heures »
           * — est indiscernable d'une réussite : c'est exactement ainsi qu'une
           * planification cassée passait inaperçue jusqu'au jour où l'on avait
           * besoin de ce qu'elle était censée faire.
           */
          if (row.original.lastRunFailure) {
            return (
              <span
                className="inline-flex items-center gap-1.5"
                title={row.original.lastRunFailure}
              >
                <Badge variant="danger">{t("lastRunFailed")}</Badge>
                <RelativeTime className="text-muted text-xs" value={at} />
              </span>
            );
          }

          return <RelativeTime className="text-muted" value={at} />;
        },
      },
      {
        accessorKey: "nextRunAt",
        header: t("columnNextRun"),
        cell: ({ row }) => {
          if (!row.original.isActive) return <Badge>{t("paused")}</Badge>;
          // Une expression valide peut ne jamais survenir — « 31 février ».
          // Le dire, plutôt que d'afficher un vide qu'on lirait comme « bientôt ».
          if (!row.original.nextRunAt) return <Badge variant="warning">{t("neverRuns")}</Badge>;
          return <RelativeTime className="text-muted" value={row.original.nextRunAt} />;
        },
      },
      {
        id: "active",
        header: t("columnActive"),
        size: 80,
        cell: ({ row }) => (
          <Switch
            checked={row.original.isActive}
            disabled={pending}
            onCheckedChange={(next) =>
              run(() => setScheduleActive(serverId, row.original.id, next))
            }
            aria-label={t("enableLabel", { name: row.original.name })}
          />
        ),
      },
      {
        id: "actions",
        header: "",
        size: 60,
        cell: ({ row }) => (
          <RowActions>
            <DropdownItem
              icon={<Play />}
              disabled={pending}
              onSelect={() => run(() => runScheduleNow(serverId, row.original.id))}
            >
              {t("runNow")}
            </DropdownItem>
            <DropdownItem icon={<Pencil />} disabled={pending} onSelect={() => open(row.original)}>
              {tc("edit")}
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem icon={<Trash2 />} destructive onSelect={() => setToDelete(row.original)}>
              {tc("delete")}
            </DropdownItem>
          </RowActions>
        ),
      },
    ],
    [serverId, pending, run, open, t, tc],
  );

  const submit = () => {
    const input = { name: name.trim(), cron, isActive: true, onlyWhenOnline, tasks };
    const target = editing;
    if (target === "new") {
      run(
        () => createSchedule(serverId, input),
        () => setEditing(null),
      );
    } else if (target) {
      run(
        () => updateSchedule(serverId, target.id, { ...input, isActive: target.isActive }),
        () => setEditing(null),
      );
    }
  };

  return (
    <PageTemplate
      header={
        <PageHeader
          icon={<Calendar />}
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <Button disabled={pending} onClick={() => open("new")}>
              <Plus /> {t("create")}
            </Button>
          }
        />
      }
    >
      {error ? (
        <AlertBanner variant="danger" title={tc("refused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      <DataTable
        columns={columns}
        data={initial}
        getRowId={(row) => row.id}
        emptyState={
          <EmptyState
            icon={<Calendar />}
            title={t("empty")}
            description={t("emptyHint")}
            action={
              <Button onClick={() => open("new")}>
                <Plus /> {t("create")}
              </Button>
            }
          />
        }
      />

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent
          size="lg"
          title={editing === "new" ? t("newTitle") : t("editTitle")}
          description={t("utcNotice")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                {tc("cancel")}
              </Button>
              <Button disabled={name.trim() === "" || pending} onClick={submit}>
                {tc("save")}
              </Button>
            </>
          }
        >
          <div className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto">
            <FormField label={t("nameLabel")}>
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("namePlaceholder")}
                />
              )}
            </FormField>

            <CronBuilder value={cron} onChange={setCron} />

            <div className="flex flex-col gap-3">
              <p className="text-sm font-semibold text-fg">{t("steps")}</p>
              {tasks.map((task, index) => (
                <div
                  key={task.key}
                  className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SelectMenu
                      value={task.action}
                      onValueChange={(v) =>
                        setTasks((list) =>
                          list.map((t, i) =>
                            i === index ? { ...t, action: v as ScheduleAction } : t,
                          ),
                        )
                      }
                      options={ACTIONS.map((action) => ({
                        value: action.value,
                        label: t(action.key),
                        description: t(`${action.key}Hint`),
                      }))}
                    />
                    <Input
                      value={task.payload}
                      onChange={(e) =>
                        setTasks((list) =>
                          list.map((t, i) => (i === index ? { ...t, payload: e.target.value } : t)),
                        )
                      }
                      placeholder={
                        task.action === "command"
                          ? t("commandPlaceholder")
                          : task.action === "power"
                            ? "restart"
                            : t("backupPlaceholder")
                      }
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <label
                      className="flex items-center gap-2 text-sm text-muted"
                      htmlFor={`offset-${task.key}`}
                    >
                      {t("waitBefore")}
                      <Input
                        id={`offset-${task.key}`}
                        type="number"
                        min={0}
                        className="w-24"
                        value={task.timeOffset}
                        onChange={(e) =>
                          setTasks((list) =>
                            list.map((t, i) =>
                              i === index ? { ...t, timeOffset: Number(e.target.value) } : t,
                            ),
                          )
                        }
                      />
                      {t("secondsBefore")}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-muted">
                      <input
                        type="checkbox"
                        checked={task.continueOnFailure}
                        onChange={(e) =>
                          setTasks((list) =>
                            list.map((t, i) =>
                              i === index ? { ...t, continueOnFailure: e.target.checked } : t,
                            ),
                          )
                        }
                      />
                      {t("continueOnFailure")}
                    </label>
                    {tasks.length > 1 ? (
                      <Button
                        variant="danger-ghost"
                        size="sm"
                        onClick={() => setTasks((list) => list.filter((_, i) => i !== index))}
                      >
                        <Trash2 /> {tc("remove")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setTasks((list) => [...list, emptyTask()])}
              >
                <Plus /> {t("addStep")}
              </Button>
            </div>

            <div className="border-t border-border pt-1">
              <SettingToggle
                label={t("onlyWhenOnline")}
                description={t("onlyWhenOnlineHint")}
                checked={onlyWhenOnline}
                onCheckedChange={setOnlyWhenOnline}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={t("deleteTitle")}
        description={toDelete ? t("deleteBody", { name: toDelete.name }) : undefined}
        confirmLabel={tc("delete")}
        destructive
        onConfirm={() => {
          const target = toDelete;
          setToDelete(null);
          if (target) run(() => deleteSchedule(serverId, target.id));
        }}
      />
    </PageTemplate>
  );
}
