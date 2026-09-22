"use client";

import { APPLICATION_KEY_MAX_DAYS, APPLICATION_SCOPE_CATALOGUE } from "@gamedashboard/contracts";
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
  FormField,
  Input,
  RelativeTime,
  SettingToggle,
} from "@gamedashboard/ui";
import { Plug, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ApplicationKey } from "@/server/api/application-keys";

/**
 * Émission et révocation des clés de l'API applicative.
 *
 * L'écran d'un secret qu'on ne reverra pas : le panneau affiche la clé en clair
 * une fois, puis plus jamais — la base n'en garde qu'un condensat. Prétendre
 * pouvoir la réafficher obligerait à la stocker déchiffrable, et une fuite de
 * la base livrerait alors tout le parc à qui la lit.
 *
 * **Le même écran sert l'administration et l'espace revendeur.** Les deux font
 * exactement le même geste — nommer, cocher des portées, borner à des adresses,
 * obtenir un secret une fois — et seules changent les routes appelées et les
 * portées proposées. En écrire un second aurait garanti qu'une correction faite
 * d'un côté manque de l'autre ; ce sont les actions qui varient, pas l'écran.
 */
export function ApplicationKeys({
  keys,
  actions,
  catalogue = APPLICATION_SCOPE_CATALOGUE,
}: {
  keys: ApplicationKey[];
  /**
   * Ce que « créer » et « révoquer » veulent dire ici.
   *
   * Passées plutôt qu'importées : un composant qui choisirait lui-même sa
   * route d'administration ne pourrait pas servir au revendeur, et l'inverse
   * serait pire — un revendeur qui appellerait la route d'administration.
   */
  actions: {
    create: (input: {
      name: string;
      scopes: string[];
      allowedIps: string[];
      expiresInDays: number;
    }) => Promise<{ plaintext: string | null; error: string | null }>;
    revoke: (keyId: string) => Promise<{ error: string | null }>;
  };
  /**
   * Les portées proposées. Celles de la plateforme sont retirées pour un
   * revendeur : les afficher ferait cocher des cases que l'API refuse ensuite.
   */
  catalogue?: typeof APPLICATION_SCOPE_CATALOGUE;
}) {
  const t = useTranslations("applicationKeys");
  const tc = useTranslations("common");
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [allowedIps, setAllowedIps] = useState("");
  const [days, setDays] = useState(String(APPLICATION_KEY_MAX_DAYS));
  const [scopes, setScopes] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const [toRevoke, setToRevoke] = useState<ApplicationKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (scope: string, granted: boolean) =>
    setScopes((current) =>
      granted ? [...new Set([...current, scope])] : current.filter((s) => s !== scope),
    );

  const submit = () =>
    startTransition(async () => {
      const result = await actions.create({
        name,
        scopes,
        // Une ligne par adresse : on colle ce que l'hébergeur du système tiers
        // a communiqué, sans reformater à la main.
        allowedIps: allowedIps
          .split(/[\s,]+/)
          .map((ip) => ip.trim())
          .filter((ip) => ip !== ""),
        expiresInDays: Number(days),
      });

      setError(result.error);
      if (result.error) return;

      setOpen(false);
      setSecret(result.plaintext);
      setName("");
      setAllowedIps("");
      setScopes([]);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader
        icon={<Plug />}
        title={t("title")}
        description={t("hint")}
        actions={
          <Button onClick={() => setOpen(true)}>
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

        {/* Le secret, une seule fois. Il n'est pas dans la liste en dessous
            parce qu'il n'est nulle part : la base n'en a que le condensat. */}
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

        {keys.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t("empty")}</p>
        ) : (
          <div className="divide-y divide-border">
            {keys.map((key) => {
              const expired =
                key.expiresAt !== null && new Date(key.expiresAt).getTime() <= Date.now();

              return (
                <div key={key.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
                  <div className="min-w-56 flex-1">
                    <p className="font-semibold text-fg">{key.name}</p>
                    <p className="gd-mono text-xs text-muted">{key.prefix}…</p>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {key.scopes.map((scope) => (
                      <Badge key={scope} variant="accent">
                        <span className="gd-mono text-xs">{scope}</span>
                      </Badge>
                    ))}
                  </div>

                  <span className="text-xs text-muted">
                    {key.allowedIps.length === 0
                      ? t("anyIp")
                      : t("ipCount", { count: key.allowedIps.length })}
                  </span>

                  <div className="text-xs">
                    {key.revokedAt ? (
                      <Badge variant="danger">{t("revoked")}</Badge>
                    ) : expired ? (
                      <Badge variant="warning">{t("expired")}</Badge>
                    ) : (
                      <Badge variant="success">{t("active")}</Badge>
                    )}
                  </div>

                  <span className="text-xs text-faint">
                    {/* Jamais utilisée n'est pas « utilisée il y a longtemps » :
                        c'est le signe d'une intégration jamais branchée. */}
                    {key.lastUsedAt ? <RelativeTime value={key.lastUsedAt} /> : t("neverUsed")}
                  </span>

                  {key.revokedAt ? null : (
                    <Button
                      variant="danger-ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => setToRevoke(key)}
                    >
                      <Trash2 /> {t("revoke")}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardBody>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={t("createTitle")}
          description={t("createHint")}
          footer={
            <Button
              disabled={pending || name.trim() === "" || scopes.length === 0}
              onClick={submit}
            >
              {t("create")}
            </Button>
          }
        >
          <div className="flex flex-col gap-4">
            <FormField label={t("nameLabel")} description={t("nameHint")}>
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("namePlaceholder")}
                />
              )}
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t("ipsLabel")} description={t("ipsHint")}>
                {(id) => (
                  <Input
                    id={id}
                    className="gd-mono"
                    value={allowedIps}
                    onChange={(e) => setAllowedIps(e.target.value)}
                    placeholder="203.0.113.10"
                  />
                )}
              </FormField>
              <FormField label={t("daysLabel")} description={t("daysHint")}>
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    max={APPLICATION_KEY_MAX_DAYS}
                    className="gd-mono"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                  />
                )}
              </FormField>
            </div>

            {/* Rien n'est coché par défaut : une clé se compose en choisissant
                ce qu'on accorde, pas en retirant ce qu'on avait déjà donné. */}
            <div className="flex flex-col gap-4">
              {catalogue.map((group) => (
                <div key={group.key} className="flex flex-col gap-2">
                  <div>
                    <p className="font-semibold text-fg text-sm">{group.label}</p>
                    <p className="text-muted text-xs">{group.description}</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.scopes.map((entry) => (
                      <SettingToggle
                        key={entry.scope}
                        checked={scopes.includes(entry.scope)}
                        onCheckedChange={(next) => toggle(entry.scope, next)}
                        label={entry.label}
                        description={entry.scope}
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
        open={toRevoke !== null}
        onOpenChange={(o) => !o && setToRevoke(null)}
        title={t("revokeTitle")}
        description={t("revokeBody", { name: toRevoke?.name ?? "" })}
        confirmLabel={t("revoke")}
        destructive
        onConfirm={() => {
          const target = toRevoke;
          setToRevoke(null);
          if (!target) return;
          startTransition(async () => {
            const result = await actions.revoke(target.id);
            setError(result.error);
            if (!result.error) router.refresh();
          });
        }}
      />
    </Card>
  );
}
