"use client";

import { isPlayerName, type PlayerAction } from "@gamedashboard/contracts";
import {
  AlertBanner,
  Button,
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
import { Gavel, UserRound, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { actOnPlayer, type PlayersView } from "@/server/api/players";
import { ServerBlockBanner, useServerBlock } from "./server-block-context";

/** Actions qui acceptent un motif, recopié dans la commande. */
const WITH_REASON: readonly PlayerAction[] = ["kick", "ban"];
/** Actions qui retirent un joueur du serveur : présentées en rouge. */
const DESTRUCTIVE: readonly PlayerAction[] = ["kick", "ban"];

/**
 * Les joueurs d'un serveur, et ce qu'on peut leur faire.
 *
 * La liste vient de la sonde de jeu, pas du daemon : c'est un **échantillon**
 * (Minecraft n'en montre qu'une douzaine), et l'écran le dit plutôt que de
 * laisser croire qu'il n'y a personne d'autre. Le formulaire « Agir sur un
 * joueur » vise aussi un joueur absent de la liste : bannir quelqu'un qui
 * vient de partir est l'usage le plus courant.
 */
export function PlayersWorkspace({ serverId, view }: { serverId: string; view: PlayersView }) {
  const t = useTranslations("players");
  const tc = useTranslations("common");
  const bloc = useServerBlock();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [form, setForm] = useState<{ player: string; action: PlayerAction; reason: string } | null>(
    null,
  );

  const first = view.actions[0];
  const open = (player: string, action: PlayerAction | undefined = first) => {
    if (action) setForm({ player, action, reason: "" });
  };

  const submit = () =>
    startTransition(async () => {
      if (!form) return;
      const { player, action, reason } = form;
      const result = await actOnPlayer(serverId, {
        action,
        player: player.trim(),
        ...(WITH_REASON.includes(action) && reason.trim() ? { reason } : {}),
      });
      setError(result.error);
      if (result.error) return;
      setSent(t("sent", { action: t(`action.${action}`), player: player.trim() }));
      setForm(null);
    });

  const counter =
    view.online === null
      ? t("unknownCount")
      : t("counter", { online: view.online, max: view.max ?? "?" });

  return (
    <PageTemplate
      notice={<ServerBlockBanner />}
      header={
        <PageHeader
          icon={<Users />}
          title={t("title")}
          subtitle={t("subtitle")}
          actions={
            view.actions.length > 0 ? (
              <Button onClick={() => open("")} disabled={pending || bloc !== null}>
                <Gavel /> {t("act")}
              </Button>
            ) : null
          }
        />
      }
    >
      {error ? (
        <AlertBanner variant="danger" title={tc("refused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}
      {sent ? (
        <AlertBanner variant="success" dismissible>
          {sent}
        </AlertBanner>
      ) : null}
      {view.actions.length === 0 ? (
        <AlertBanner variant="info" title={t("noCommands")}>
          {t("noCommandsHint")}
        </AlertBanner>
      ) : null}

      <div className="flex flex-wrap items-baseline gap-3">
        <p className="text-2xl font-semibold text-fg" data-instable>
          {counter}
        </p>
        {view.observedAt ? (
          <span className="text-xs text-muted">
            {t("observed")} <RelativeTime value={view.observedAt} />
          </span>
        ) : null}
      </div>

      {view.observedAt === null ? (
        <EmptyState icon={<Users />} title={t("noProbe")} description={t("noProbeHint")} />
      ) : !view.sample || view.sample.length === 0 ? (
        <EmptyState icon={<Users />} title={t("empty")} description={t("emptyHint")} />
      ) : (
        <>
          {!view.complete ? <AlertBanner variant="info">{t("partial")}</AlertBanner> : null}
          <div
            className="flex flex-col divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card"
            data-instable-liste
          >
            {view.sample.map((player) => (
              <div key={player} className="flex items-center gap-3 px-5 py-3">
                <UserRound className="size-4 text-muted" aria-hidden />
                <span className="gd-mono min-w-0 flex-1 truncate text-sm text-fg">{player}</span>
                {/* Un nom qu'aucune commande n'accepterait (espace, accent : jeux
                    Steam, FiveM) s'affiche sans actions plutôt qu'avec un refus. */}
                {view.actions.length > 0 && bloc === null && isPlayerName(player) ? (
                  <RowActions>
                    {view.actions.map((action) => (
                      <DropdownItem
                        key={action}
                        destructive={DESTRUCTIVE.includes(action)}
                        onSelect={() => open(player, action)}
                      >
                        {t(`action.${action}`)}
                      </DropdownItem>
                    ))}
                  </RowActions>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}

      <Dialog open={form !== null} onOpenChange={(value) => !value && setForm(null)}>
        <DialogContent
          title={t("act")}
          description={t("actHint")}
          footer={
            <Button disabled={pending || !form || form.player.trim() === ""} onClick={submit}>
              {t("send")}
            </Button>
          }
        >
          {form ? (
            <div className="flex flex-col gap-4">
              <FormField label={t("playerLabel")}>
                {(id) => (
                  <Input
                    id={id}
                    value={form.player}
                    maxLength={32}
                    autoComplete="off"
                    onChange={(e) => setForm({ ...form, player: e.target.value })}
                  />
                )}
              </FormField>
              <FormField label={t("actionLabel")}>
                {(id) => (
                  <Select
                    id={id}
                    value={form.action}
                    options={view.actions.map((value) => ({ value, label: t(`action.${value}`) }))}
                    onChange={(e) => setForm({ ...form, action: e.target.value as PlayerAction })}
                  />
                )}
              </FormField>
              {WITH_REASON.includes(form.action) ? (
                <FormField label={t("reasonLabel")} description={t("reasonHint")}>
                  {(id) => (
                    <Input
                      id={id}
                      value={form.reason}
                      maxLength={100}
                      onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    />
                  )}
                </FormField>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </PageTemplate>
  );
}
