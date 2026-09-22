"use client";

import { WEBHOOK_EVENT_CATALOGUE } from "@gamedashboard/contracts";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CodeBlock,
  ConfirmDialog,
  Dialog,
  DialogContent,
  EmptyState,
  FormField,
  Input,
  RelativeTime,
  SelectMenu,
  SettingToggle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@gamedashboard/ui";
import { KeyRound, Plus, RadioTower, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ApplicationKey } from "@/server/api/application-keys";
import type { PlatformWebhook, WebhookDelivery } from "@/server/api/webhooks";

/**
 * Ce que « déclarer », « regénérer », « suspendre » et « supprimer » veulent
 * dire ici.
 *
 * Passées plutôt qu'importées, pour la même raison que sur l'écran des clés :
 * un composant qui choisirait lui-même ses routes d'administration ne pourrait
 * pas servir au revendeur, et l'inverse serait pire — un revendeur qui
 * appellerait les routes d'administration.
 */
export interface WebhookActions {
  create: (input: {
    applicationKeyId: string;
    url: string;
    events: string[];
  }) => Promise<{ secret: string | null; error: string | null }>;
  rotate: (webhookId: string) => Promise<{ secret: string | null; error: string | null }>;
  setActive: (webhookId: string, active: boolean) => Promise<{ error: string | null }>;
  remove: (webhookId: string) => Promise<{ error: string | null }>;
}

/**
 * Rappels sortants vers les systèmes tiers.
 *
 * Deux onglets qui répondent à deux questions différentes : « où j'envoie » et
 * « qu'est-ce qui est arrivé ». La seconde est celle qu'on se pose quand une
 * intégration est muette, et sans elle le diagnostic se ferait dans les
 * journaux du processus — c'est-à-dire pas du tout.
 *
 * **Le même écran sert l'administration et l'espace revendeur.** Le geste est
 * identique — choisir une clé, donner une URL, cocher des événements, obtenir
 * un secret une fois — et seules changent les routes appelées. En écrire un
 * second aurait garanti qu'une correction faite d'un côté manque de l'autre ;
 * ce sont les actions qui varient, pas l'écran.
 *
 * Ce qu'un rappel **reçoit** ne se règle pas ici : c'est le périmètre de la clé
 * qui en décide, et l'émetteur qui s'en assure. Un sélecteur d'événements ne
 * peut donc pas élargir ce qu'on voit — seulement le restreindre.
 */
export function PlatformWebhooks({
  webhooks,
  deliveries,
  keys,
  actions,
}: {
  webhooks: PlatformWebhook[];
  deliveries: WebhookDelivery[];
  keys: ApplicationKey[];
  actions: WebhookActions;
}) {
  const t = useTranslations("webhooks");
  const tc = useTranslations("common");
  const router = useRouter();

  // Une clé révoquée ne peut plus rien recevoir d'utile : la proposer mènerait
  // à un refus que rien n'explique à l'écran.
  const usableKeys = keys.filter((key) => key.revokedAt === null);

  const [open, setOpen] = useState(false);
  const [keyId, setKeyId] = useState(usableKeys[0]?.id ?? "");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<PlatformWebhook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (event: string, on: boolean) =>
    setEvents((current) =>
      on ? [...new Set([...current, event])] : current.filter((e) => e !== event),
    );

  const submit = () =>
    startTransition(async () => {
      const result = await actions.create({ applicationKeyId: keyId, url, events });
      setError(result.error);
      if (result.error) return;

      setOpen(false);
      setSecret(result.secret);
      setUrl("");
      setEvents([]);
      router.refresh();
    });

  const run = (action: () => Promise<{ error: string | null }>) =>
    startTransition(async () => {
      const result = await action();
      setError(result.error);
      if (!result.error) router.refresh();
    });

  return (
    <Card>
      <CardHeader
        icon={<RadioTower />}
        title={t("title")}
        description={t("hint")}
        actions={
          <Button disabled={usableKeys.length === 0} onClick={() => setOpen(true)}>
            <Plus /> {t("create")}
          </Button>
        }
      />
      <CardBody className="flex flex-col gap-4">
        {error ? (
          <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
            {error}
          </AlertBanner>
        ) : null}

        {/* Sans clé applicative, il n'y a personne à prévenir : le dire plutôt
            que de laisser un bouton grisé sans explication. */}
        {usableKeys.length === 0 ? (
          <AlertBanner variant="info" title={t("noKeys")}>
            {t("noKeysBody")}
          </AlertBanner>
        ) : null}

        {secret ? (
          <div className="flex flex-col gap-2">
            <AlertBanner variant="warning" title={t("secretOnce")}>
              {t("secretOnceBody")}
            </AlertBanner>
            <CodeBlock title={t("secretTitle")} code={secret} />
            <div>
              <Button variant="secondary" onClick={() => setSecret(null)}>
                {t("secretHide")}
              </Button>
            </div>
          </div>
        ) : null}

        <Tabs defaultValue="endpoints">
          <TabsList>
            <TabsTrigger value="endpoints" count={webhooks.length}>
              {t("tabEndpoints")}
            </TabsTrigger>
            <TabsTrigger value="deliveries" count={deliveries.length}>
              {t("tabDeliveries")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="endpoints" className="pt-4">
            {webhooks.length === 0 ? (
              <EmptyState icon={<RadioTower />} title={t("empty")} description={t("emptyHint")} />
            ) : (
              <div className="divide-y divide-border">
                {webhooks.map((hook) => (
                  <div key={hook.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
                    <div className="min-w-64 flex-1">
                      <p className="gd-mono truncate text-fg text-sm">{hook.url}</p>
                      <p className="text-muted text-xs">
                        <KeyRound className="inline size-3" /> {hook.applicationKeyName}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {hook.events.map((event) => (
                        <Badge key={event} variant="neutral">
                          <span className="gd-mono text-xs">{event}</span>
                        </Badge>
                      ))}
                    </div>

                    <div className="text-xs">
                      {/* La dernière réussite plutôt qu'un compteur d'échecs :
                          « rien n'est passé depuis trois semaines » se lit d'un
                          coup d'œil, un compteur remis à zéro ne dit rien. */}
                      {hook.lastSuccessAt ? (
                        <span className="text-muted">
                          {t("lastSuccess")} <RelativeTime value={hook.lastSuccessAt} />
                        </span>
                      ) : (
                        <span className="text-faint">{t("neverDelivered")}</span>
                      )}
                    </div>

                    <SettingToggle
                      label={hook.isActive ? t("active") : t("paused")}
                      checked={hook.isActive}
                      disabled={pending}
                      onCheckedChange={(next) => run(() => actions.setActive(hook.id, next))}
                    />

                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await actions.rotate(hook.id);
                          setError(result.error);
                          if (!result.error) {
                            setSecret(result.secret);
                            router.refresh();
                          }
                        })
                      }
                    >
                      {t("rotate")}
                    </Button>

                    <Button
                      variant="danger-ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => setToDelete(hook)}
                    >
                      <Trash2 /> {tc("delete")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="deliveries" className="pt-4">
            {deliveries.length === 0 ? (
              <EmptyState
                icon={<RadioTower />}
                title={t("noDeliveries")}
                description={t("noDeliveriesHint")}
              />
            ) : (
              <div className="divide-y divide-border">
                {deliveries.map((delivery) => (
                  <div
                    key={delivery.id}
                    className="flex flex-wrap items-center gap-x-6 gap-y-1 py-2.5"
                  >
                    <span className="gd-mono min-w-48 flex-1 text-fg text-sm">
                      {delivery.event}
                    </span>

                    {delivery.deliveredAt ? (
                      <Badge variant="success">{t("delivered")}</Badge>
                    ) : delivery.abandonedAt ? (
                      <Badge variant="danger">{t("abandoned")}</Badge>
                    ) : (
                      <Badge variant="warning">{t("retrying")}</Badge>
                    )}

                    <span className="gd-mono text-muted text-xs">
                      {/* Aucune réponse n'est pas un code d'erreur : c'est une
                          panne réseau, et la distinction change le diagnostic. */}
                      {delivery.responseStatus ?? t("noResponse")}
                    </span>

                    <span className="text-muted text-xs">
                      {t("attempts", { count: delivery.attempts })}
                    </span>

                    {delivery.nextAttemptAt ? (
                      <span className="text-faint text-xs">
                        {t("nextAttempt")} <RelativeTime value={delivery.nextAttemptAt} />
                      </span>
                    ) : null}

                    <RelativeTime className="text-faint text-xs" value={delivery.createdAt} />
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardBody>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={t("createTitle")}
          description={t("createHint")}
          footer={
            <Button
              disabled={pending || url.trim() === "" || events.length === 0 || keyId === ""}
              onClick={submit}
            >
              {t("create")}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <FormField label={t("keyLabel")} description={t("keyHint")}>
              {(id) => (
                <SelectMenu
                  id={id}
                  value={keyId}
                  onValueChange={setKeyId}
                  options={usableKeys.map((key) => ({ value: key.id, label: key.name }))}
                />
              )}
            </FormField>

            <FormField label={t("urlLabel")} description={t("urlHint")}>
              {(id) => (
                <Input
                  id={id}
                  className="gd-mono"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://boutique.exemple.fr/gamedashboard/hook"
                />
              )}
            </FormField>

            <div className="flex flex-col gap-4">
              {WEBHOOK_EVENT_CATALOGUE.map((group) => (
                <div key={group.key} className="flex flex-col gap-2">
                  <p className="font-semibold text-fg text-sm">{group.label}</p>
                  <div className="grid gap-2">
                    {group.events.map((entry) => (
                      <SettingToggle
                        key={entry.event}
                        checked={events.includes(entry.event)}
                        onCheckedChange={(next) => toggle(entry.event, next)}
                        label={entry.label}
                        description={entry.event}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
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
        onConfirm={() => {
          const target = toDelete;
          setToDelete(null);
          if (target) run(() => actions.remove(target.id));
        }}
      />
    </Card>
  );
}
