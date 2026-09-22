"use client";

import {
  AlertBanner,
  Button,
  CodeBlock,
  type ColumnDef,
  ConfirmDialog,
  CopyButton,
  DataTable,
  Dialog,
  DialogContent,
  DropdownItem,
  DropdownSeparator,
  EmptyState,
  Input,
  MetricBar,
  PageHeader,
  PageTemplate,
  RowActions,
} from "@gamedashboard/ui";
import { Database, Eye, KeyRound, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState, useTransition } from "react";
import {
  createDatabase,
  type DatabaseList,
  deleteDatabase,
  revealDatabasePassword,
  rotateDatabasePassword,
  type ServerDatabase,
} from "@/server/api/databases";
import { ServerBlockBanner, useServerBlock } from "./server-block-context";

/**
 * Bases de données d'un serveur.
 *
 * Les bases existent réellement sur un hôte MySQL : créer une ligne ici crée
 * une base, et la supprimer la détruit. Rien n'est simulé, ce qui explique la
 * prudence des confirmations — il n'existe pas de corbeille pour un
 * `DROP DATABASE`.
 */
export function DatabasesWorkspace({
  serverId,
  initial,
}: {
  serverId: string;
  initial: DatabaseList;
}) {
  const t = useTranslations("databases");
  const tc = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [remote, setRemote] = useState("%");
  const [toDelete, setToDelete] = useState<ServerDatabase | null>(null);
  const [secret, setSecret] = useState<{ database: ServerDatabase; password: string } | null>(null);
  const [pending, startTransition] = useTransition();
  /*
   * Seule la création est refusée par l'API, et c'est la bonne borne.
   *
   * Une base vit sur le serveur MySQL, pas dans le conteneur : en créer une
   * pour un serveur suspendu poserait une ressource qui survit à la coupure.
   * Consulter le mot de passe, le changer ou supprimer la base restent
   * ouverts — ce sont les gestes de quelqu'un qui range, pas de quelqu'un qui
   * consomme.
   */
  const bloc = useServerBlock();

  const run = useCallback(
    (action: () => Promise<{ error: string | null }>) =>
      startTransition(async () => {
        const result = await action();
        setError(result.error);
        if (!result.error) router.refresh();
      }),
    [router],
  );

  /**
   * Affiche un mot de passe, qu'il vienne d'une lecture ou d'une régénération.
   *
   * Les deux chemins aboutissent à la même boîte : celui qui régénère doit voir
   * le nouveau mot de passe immédiatement, sinon il vient d'enfermer son
   * serveur dehors sans moyen de le faire rentrer.
   */
  const showPassword = useCallback(
    (
      database: ServerDatabase,
      fetcher: () => Promise<{ password: string | null; error: string | null }>,
    ) =>
      startTransition(async () => {
        const result = await fetcher();
        setError(result.error);
        if (result.password) setSecret({ database, password: result.password });
        router.refresh();
      }),
    [router],
  );

  const columns = useMemo<ColumnDef<ServerDatabase, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columnDatabase"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="gd-mono truncate font-semibold text-fg">{row.original.name}</p>
            <p className="gd-mono truncate text-xs text-muted">{row.original.username}</p>
          </div>
        ),
      },
      {
        accessorKey: "host",
        header: t("columnHost"),
        cell: ({ row }) => (
          <span className="gd-mono text-muted">
            {row.original.host}:{row.original.port}
          </span>
        ),
      },
      {
        accessorKey: "remote",
        header: t("columnRemote"),
        cell: ({ getValue }) => <span className="gd-mono text-muted">{getValue() as string}</span>,
      },
      {
        id: "actions",
        header: "",
        size: 60,
        cell: ({ row }) => {
          const database = row.original;
          return (
            <RowActions>
              <DropdownItem
                icon={<Eye />}
                disabled={pending}
                onSelect={() =>
                  showPassword(database, () => revealDatabasePassword(serverId, database.id))
                }
              >
                {t("showPassword")}
              </DropdownItem>
              <DropdownItem
                icon={<KeyRound />}
                disabled={pending}
                onSelect={() =>
                  showPassword(database, () => rotateDatabasePassword(serverId, database.id))
                }
              >
                {t("rotatePassword")}
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem icon={<Trash2 />} destructive onSelect={() => setToDelete(database)}>
                {tc("delete")}
              </DropdownItem>
            </RowActions>
          );
        },
      },
    ],
    [serverId, pending, showPassword, t, tc],
  );

  const full = initial.used >= initial.limit;

  return (
    <PageTemplate
      notice={<ServerBlockBanner />}
      header={
        <PageHeader
          icon={<Database />}
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <Button disabled={full || pending || bloc !== null} onClick={() => setCreating(true)}>
              <Plus /> {t("create")}
            </Button>
          }
        />
      }
      toolbar={
        <div className="rounded-card border border-border bg-surface px-5 py-4 shadow-card">
          <MetricBar
            label={t("quota")}
            value={initial.used}
            max={initial.limit}
            format={(v) => `${v}`}
          />
        </div>
      }
    >
      {error ? (
        <AlertBanner variant="danger" title={tc("refused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      <DataTable
        columns={columns}
        data={initial.items}
        getRowId={(row) => row.id}
        emptyState={
          <EmptyState
            icon={<Database />}
            title={t("empty")}
            description={t("emptyHint")}
            action={
              <Button disabled={full || bloc !== null} onClick={() => setCreating(true)}>
                <Plus /> {t("create")}
              </Button>
            }
          />
        }
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent
          title={t("newTitle")}
          description={t("newBody")}
          footer={
            <Button
              disabled={name.trim() === "" || pending}
              onClick={() => {
                run(() => createDatabase(serverId, name.trim(), remote.trim() || "%"));
                setCreating(false);
                setName("");
                setRemote("%");
              }}
            >
              {tc("create")}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-fg" htmlFor="db-name">
                {t("nameLabel")}
              </label>
              <Input
                id="db-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="survie"
                autoFocus
              />
              <span className="text-xs text-muted">{t("nameHint")}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-fg" htmlFor="db-remote">
                {t("columnRemote")}
              </label>
              <Input
                id="db-remote"
                value={remote}
                onChange={(e) => setRemote(e.target.value)}
                placeholder="%"
              />
              <span className="text-xs text-muted">{t("remoteHint")}</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Le mot de passe n'existe que dans cette boîte : il n'est pas rendu avec
          la liste, et disparaît à la fermeture. Le laisser dans le tableau
          l'exposerait à toute capture d'écran de la page. */}
      <Dialog open={secret !== null} onOpenChange={(open) => !open && setSecret(null)}>
        <DialogContent title={t("credentials")} description={t("credentialsBody")}>
          {secret ? (
            <CodeBlock
              title={secret.database.name}
              code={[
                `Hôte        ${secret.database.host}:${secret.database.port}`,
                `Base        ${secret.database.name}`,
                `Utilisateur ${secret.database.username}`,
                `Mot de passe ${secret.password}`,
              ].join("\n")}
            />
          ) : null}
          {secret ? <CopyButton value={secret.password} label={t("copyPassword")} /> : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t("deleteTitle")}
        description={t("deleteBody")}
        confirmLabel={tc("delete")}
        destructive
        requireTyped={toDelete?.name}
        onConfirm={() => {
          const target = toDelete;
          setToDelete(null);
          if (target) run(() => deleteDatabase(serverId, target.id));
        }}
      />
    </PageTemplate>
  );
}
