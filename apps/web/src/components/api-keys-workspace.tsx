"use client";

import { PERMISSION_GROUPS } from "@gamedashboard/contracts";
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
  EmptyState,
  FormField,
  Input,
  PageHeader,
  PageTemplate,
  PermissionMatrix,
  RelativeTime,
} from "@gamedashboard/ui";
import { Key, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState, useTransition } from "react";
import { type ApiKey, createApiKey, revokeApiKey } from "@/server/api/api-keys";

/**
 * Clés d'API du compte.
 *
 * Une clé d'API porte les droits de son propriétaire, **bornés par ses
 * portées** : c'est la matrice ci-dessous qui décide de ce qu'un script pourra
 * faire, pas le compte auquel il appartient. Une clé pour un bot Discord qui ne
 * fait que redémarrer n'a aucune raison de pouvoir effacer les fichiers.
 */
export function ApiKeysWorkspace({ initial }: { initial: ApiKey[] }) {
  const t = useTranslations("apiKeys");
  const tc = useTranslations("common");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [toRevoke, setToRevoke] = useState<ApiKey | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [ips, setIps] = useState("");
  // Vide : l'API pose le maximum, un an. Une clé de script ne tourne pas
  // d'elle-même : sans fin, elle survivait à l'oubli (NC-36).
  const [days, setDays] = useState("");
  const [scopes, setScopes] = useState<string[]>(["console.read", "power.start", "power.restart"]);
  const [created, setCreated] = useState<string | null>(null);
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

  const columns = useMemo<ColumnDef<ApiKey, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: t("columnKey"),
        cell: ({ row }) => (
          <div>
            <p className="font-semibold text-fg">{row.original.name}</p>
            <p className="gd-mono text-xs text-muted">{row.original.prefix}_••••••••</p>
          </div>
        ),
      },
      {
        accessorKey: "scopes",
        header: t("columnScopes"),
        cell: ({ row }) => (
          <span className="text-muted">
            {t("scopesGranted", { count: row.original.scopes.length })}
          </span>
        ),
      },
      {
        accessorKey: "allowedIps",
        header: t("columnAddresses"),
        cell: ({ row }) => (
          <span className="gd-mono text-muted">
            {/* Une liste vide veut dire « toutes » : le dire, plutôt que de
                laisser une case vide qu'on lirait comme « aucune ». */}
            {row.original.allowedIps.length === 0
              ? t("allAddresses")
              : row.original.allowedIps.join(", ")}
          </span>
        ),
      },
      {
        accessorKey: "expiresAt",
        header: t("columnExpires"),
        cell: ({ getValue }) => {
          const at = getValue() as string | null;
          return at ? (
            <RelativeTime className="text-muted" value={at} />
          ) : (
            <span className="text-muted">{t("neverExpires")}</span>
          );
        },
      },
      {
        accessorKey: "lastUsedAt",
        header: t("columnLastUsed"),
        cell: ({ getValue }) => {
          const at = getValue() as string | null;
          return at ? (
            <RelativeTime className="text-muted" value={at} />
          ) : (
            <span className="text-muted">{t("neverUsed")}</span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        size: 100,
        cell: ({ row }) => (
          <Button
            variant="danger-ghost"
            size="sm"
            disabled={pending}
            onClick={() => setToRevoke(row.original)}
          >
            <Trash2 /> {tc("revoke")}
          </Button>
        ),
      },
    ],
    [pending, t, tc],
  );

  return (
    <PageTemplate
      header={
        <PageHeader
          icon={<Key />}
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <Button disabled={pending} onClick={() => setCreateOpen(true)}>
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
            icon={<Key />}
            title={t("empty")}
            description={t("emptyHint")}
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> {t("create")}
              </Button>
            }
          />
        }
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          size="lg"
          title={t("newTitle")}
          description={t("newBody")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>
                {tc("cancel")}
              </Button>
              <Button
                disabled={name.trim() === "" || scopes.length === 0 || pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await createApiKey(
                      name.trim(),
                      scopes,
                      ips
                        .split(/[\n,]/)
                        .map((ip) => ip.trim())
                        .filter((ip) => ip !== ""),
                      days.trim() === "" ? null : Number(days),
                    );
                    setError(result.error);
                    if (result.plaintext) {
                      setCreateOpen(false);
                      setCreated(result.plaintext);
                      setName("");
                      setIps("");
                      setDays("");
                      router.refresh();
                    }
                  })
                }
              >
                {t("createKey")}
              </Button>
            </>
          }
        >
          <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("label")} description={t("labelHint")}>
                {(id) => (
                  <Input
                    id={id}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("labelPlaceholder")}
                  />
                )}
              </FormField>
              <FormField label={t("allowedIps")} description={t("allowedIpsHint")}>
                {(id) => (
                  <Input
                    id={id}
                    className="gd-mono"
                    value={ips}
                    onChange={(e) => setIps(e.target.value)}
                    placeholder="82.66.14.201"
                  />
                )}
              </FormField>
              <FormField label={t("daysLabel")} description={t("daysHint")}>
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={365}
                    className="gd-mono"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    placeholder="365"
                  />
                )}
              </FormField>
            </div>
            <PermissionMatrix groups={PERMISSION_GROUPS} value={scopes} onChange={setScopes} />
          </div>
        </DialogContent>
      </Dialog>

      {/* Le secret n'existe que dans cette boîte. L'API n'en garde qu'un
          condensat : refermer sans l'avoir copié le perd définitivement. */}
      <Dialog open={created !== null} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent title={t("yourKey")} description={t("yourKeyBody")}>
          {created ? (
            <div className="flex flex-col gap-3">
              <CodeBlock code={created} />
              <CopyButton value={created} label={t("copyKey")} />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toRevoke !== null}
        onOpenChange={(o) => !o && setToRevoke(null)}
        title={t("revokeTitle")}
        description={t("revokeBody")}
        confirmLabel={tc("revoke")}
        destructive
        onConfirm={() => {
          const target = toRevoke;
          setToRevoke(null);
          if (target) run(() => revokeApiKey(target.id));
        }}
      />
    </PageTemplate>
  );
}
