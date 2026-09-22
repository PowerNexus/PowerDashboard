"use client";

import { CLIENT_WEBHOOK_CATALOGUE } from "@gamedashboard/contracts";
import {
  AlertBanner,
  Badge,
  Button,
  ConfirmDialog,
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
  Skeleton,
  StatusDot,
} from "@gamedashboard/ui";
import { KeyRound, Pencil, Plus, Trash2, Webhook } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState, useTransition } from "react";
import {
  createServerWebhook,
  deleteServerWebhook,
  listDeliveries,
  rotateServerWebhook,
  type ServerWebhook,
  type ServerWebhookDelivery,
  updateServerWebhook,
} from "@/server/api/server-webhooks";

/**
 * Les rappels sortants d'un serveur, vus par son propriétaire.
 *
 * Trois choses que cet écran doit faire, et qu'un simple formulaire ne ferait
 * pas :
 *
 * 1. **montrer le secret une seule fois**, franchement, en disant que c'est la
 *    seule ;
 * 2. **montrer l'historique des livraisons**, avec ce que le receveur a
 *    répondu — « échec 400 » n'apprend rien, la phrase du receveur dit presque
 *    toujours ce qui cloche ;
 * 3. **ne proposer que des événements qui existent**. Le catalogue vient des
 *    contrats et décrit exactement ce que le panel émet ; proposer « serveur
 *    démarré » ferait attendre un message qui ne viendrait jamais, et
 *    l'attente ressemble à un serveur tranquille.
 */
export function ServerWebhooksWorkspace({
  serverId,
  initial,
}: {
  serverId: string;
  initial: ServerWebhook[];
}) {
  const t = useTranslations("serverWebhooks");
  const tc = useTranslations("common");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [editing, setEditing] = useState<ServerWebhook | null>(null);
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);

  /** Le secret fraîchement émis, montré puis oublié. Jamais relu de l'API. */
  const [secret, setSecret] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ServerWebhook | null>(null);
  const [history, setHistory] = useState<{
    webhook: ServerWebhook;
    rows: ServerWebhookDelivery[] | null;
  } | null>(null);

  const openCreate = () => {
    setUrl("");
    setEvents([]);
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (webhook: ServerWebhook) => {
    setUrl(webhook.url);
    setEvents(webhook.events);
    setEditing(webhook);
    setCreating(true);
  };

  const submit = () =>
    startTransition(async () => {
      const result = editing
        ? await updateServerWebhook(serverId, editing.id, { url, events })
        : await createServerWebhook(serverId, { url, events });

      setError(result.error);
      if (result.error) return;

      setCreating(false);
      // Le secret n'existe qu'à la création : une modification n'en produit pas.
      if ("secret" in result && typeof result.secret === "string") setSecret(result.secret);
    });

  const openHistory = useCallback(
    (webhook: ServerWebhook) => {
      setHistory({ webhook, rows: null });
      startTransition(async () => {
        const { deliveries, error: refus } = await listDeliveries(serverId, webhook.id);
        if (refus) setError(refus);
        setHistory({ webhook, rows: deliveries });
      });
    },
    [serverId],
  );

  return (
    <PageTemplate
      header={
        <PageHeader
          icon={<Webhook />}
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            <Button onClick={openCreate} disabled={pending}>
              <Plus /> {t("declare")}
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

      {initial.length === 0 ? (
        <EmptyState icon={<Webhook />} title={t("empty")} description={t("emptyHint")} />
      ) : (
        <div className="flex flex-col divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card">
          {initial.map((webhook) => (
            <div key={webhook.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <StatusDot
                tone={webhook.isActive ? "success" : "neutral"}
                label={webhook.isActive ? t("active") : t("paused")}
              />
              <div className="min-w-0 flex-1">
                <p className="gd-mono truncate text-sm font-semibold text-fg">{webhook.url}</p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {webhook.events.map((event) => (
                    <Badge key={event} variant="neutral">
                      {labelOf(event)}
                    </Badge>
                  ))}
                </p>
              </div>
              <RelativeTime className="text-xs text-muted" value={webhook.createdAt} />
              <RowActions>
                <DropdownItem icon={<Pencil />} onSelect={() => openEdit(webhook)}>
                  {tc("edit")}
                </DropdownItem>
                <DropdownItem icon={<Webhook />} onSelect={() => openHistory(webhook)}>
                  {t("history")}
                </DropdownItem>
                <DropdownItem
                  icon={<Webhook />}
                  onSelect={() =>
                    startTransition(async () => {
                      const result = await updateServerWebhook(serverId, webhook.id, {
                        isActive: !webhook.isActive,
                      });
                      setError(result.error);
                    })
                  }
                >
                  {webhook.isActive ? t("pause") : t("resume")}
                </DropdownItem>
                {/*
                  Renouveler coupe l'ancien secret sur-le-champ : un secret
                  qu'on remplace parce qu'il a fuité ne doit pas continuer à
                  signer quoi que ce soit.
                */}
                <DropdownItem
                  icon={<KeyRound />}
                  onSelect={() =>
                    startTransition(async () => {
                      const result = await rotateServerWebhook(serverId, webhook.id);
                      setError(result.error);
                      if (result.secret) setSecret(result.secret);
                    })
                  }
                >
                  {t("rotate")}
                </DropdownItem>
                <DropdownItem icon={<Trash2 />} destructive onSelect={() => setToDelete(webhook)}>
                  {tc("delete")}
                </DropdownItem>
              </RowActions>
            </div>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent
          title={editing ? t("editTitle") : t("declareTitle")}
          description={t("declareHint")}
          footer={
            <Button disabled={pending || url.trim() === "" || events.length === 0} onClick={submit}>
              {editing ? tc("save") : tc("create")}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <FormField label={t("urlLabel")} description={t("urlHint")}>
              {(id) => (
                <Input
                  id={id}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/…"
                />
              )}
            </FormField>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-semibold text-fg">{t("eventsLabel")}</legend>
              {CLIENT_WEBHOOK_CATALOGUE.map((entry) => (
                <label key={entry.event} className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={events.includes(entry.event)}
                    onChange={(e) =>
                      setEvents((current) =>
                        e.target.checked
                          ? [...current, entry.event]
                          : current.filter((value) => value !== entry.event),
                      )
                    }
                  />
                  <span>
                    <span className="font-semibold text-fg">{entry.label}</span>
                    <span className="block text-xs text-muted">{entry.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
        </DialogContent>
      </Dialog>

      {/*
        Le secret, montré une fois et une seule.
        Le dire explicitement évite qu'on ferme la fenêtre en pensant le
        retrouver dans la liste — il n'y est pas, et aucune route ne le rend.
      */}
      <Dialog open={secret !== null} onOpenChange={(open) => !open && setSecret(null)}>
        <DialogContent title={t("secretTitle")} description={t("secretHint")}>
          <code className="block break-all rounded-field border border-border bg-surface-2 p-3 text-xs">
            {secret}
          </code>
        </DialogContent>
      </Dialog>

      <Dialog open={history !== null} onOpenChange={(open) => !open && setHistory(null)}>
        <DialogContent title={t("historyTitle")} description={history?.webhook.url}>
          {history?.rows === null ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : history?.rows.length === 0 ? (
            <p className="text-sm text-muted">{t("noDelivery")}</p>
          ) : (
            <div className="flex max-h-[50vh] flex-col divide-y divide-border overflow-y-auto">
              {history?.rows?.map((row) => (
                <div key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                  <Badge variant={toneOf(row)}>{t(`outcome.${outcomeOf(row)}`)}</Badge>
                  <span className="text-sm text-fg">{labelOf(row.event)}</span>
                  <span className="gd-mono text-xs text-muted">
                    {row.responseStatus ?? t("noResponse")}
                  </span>
                  <RelativeTime className="ml-auto text-xs text-faint" value={row.createdAt} />
                  {/*
                    La réponse du receveur en clair : c'est la seule raison pour
                    laquelle on la stocke, et presque toujours ce qui explique
                    l'échec.
                  */}
                  {row.responseBody ? (
                    <p className="gd-mono w-full break-all text-xs text-faint">
                      {row.responseBody}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={t("deleteTitle")}
        description={toDelete ? t("deleteBody", { url: toDelete.url }) : undefined}
        confirmLabel={tc("delete")}
        destructive
        onConfirm={() => {
          const target = toDelete;
          setToDelete(null);
          if (!target) return;
          startTransition(async () => {
            const result = await deleteServerWebhook(serverId, target.id);
            setError(result.error);
          });
        }}
      />
    </PageTemplate>
  );
}

/** Le libellé du catalogue, ou l'identifiant brut s'il vient d'une version plus récente. */
function labelOf(event: string): string {
  return CLIENT_WEBHOOK_CATALOGUE.find((entry) => entry.event === event)?.label ?? event;
}

function outcomeOf(row: ServerWebhookDelivery): "delivered" | "abandoned" | "pending" {
  if (row.deliveredAt) return "delivered";
  if (row.abandonedAt) return "abandoned";
  return "pending";
}

function toneOf(row: ServerWebhookDelivery): "success" | "danger" | "warning" {
  const outcome = outcomeOf(row);
  if (outcome === "delivered") return "success";
  return outcome === "abandoned" ? "danger" : "warning";
}
