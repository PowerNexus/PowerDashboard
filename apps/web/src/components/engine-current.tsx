"use client";

import type { EngineInstallRun, InstalledEngine } from "@gamedashboard/contracts";
import { AlertBanner, Badge, Button, Card, CardBody, RelativeTime } from "@gamedashboard/ui";
import { useTranslations } from "next-intl";
import { AutoRefresh } from "@/lib/use-auto-refresh";

/**
 * Ce que le panel a posé sur ce serveur, et la mise à jour du pack s'il y en a.
 *
 * Rien n'est affiché quand le panel n'a rien posé : il ne prétend pas savoir
 * ce qu'un script d'egg a installé, et un « inconnu » en tête d'écran ferait
 * croire à une panne.
 */
export function EngineCurrent({
  current,
  busy,
  onUpdate,
}: {
  current: InstalledEngine | null;
  busy: boolean;
  onUpdate: (versionId: string, label: string) => void;
}) {
  const t = useTranslations("engine");
  if (!current) return null;

  const source = current.pack?.source === "curseforge" ? "CurseForge" : "Modrinth";

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-muted text-xs">{t("currentTitle")}</p>
            <p className="truncate font-semibold text-fg">
              {current.label} <span className="text-muted">{current.versionLabel}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={current.kind === "pack" ? "warning" : "accent"}>
              {current.kind === "pack" ? `${t("kindPack")} · ${source}` : t("kindJar")}
            </Badge>
            {current.loader ? <Badge variant="neutral">{current.loader}</Badge> : null}
          </div>
        </div>

        <p className="text-muted text-xs">
          {t("currentInstalled")} <RelativeTime value={current.installedAt} />
          {current.kind === "pack"
            ? ` · ${t("currentTracked", { count: current.trackedFiles })}`
            : ""}
        </p>

        {current.update ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-border border-t pt-3">
            <p className="text-fg text-sm">
              {t("updateAvailable", { version: current.update.label })}
            </p>
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                current.update && onUpdate(current.update.versionId, current.update.label)
              }
            >
              {t("update")}
            </Button>
          </div>
        ) : current.kind === "pack" ? (
          <p className="text-muted text-xs">
            {current.checkedAt ? t("upToDate") : t("notCheckedYet")}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

/** Relecture de l'écran pendant une installation : assez pour suivre, sans marteler l'API. */
const INSTALL_REFRESH_MS = 5_000;

/**
 * La dernière installation lancée, telle que l'API la retient.
 *
 * Elle se déroule en tâche de fond : tant qu'elle est en cours, l'écran se
 * relit de lui-même (`AutoRefresh`), puis montre son compte rendu — fichiers
 * manquants, fichiers gardés parce que modifiés, ce qui reste à faire à la
 * main — ou la raison de son échec.
 */
export function EngineInstallState({ install }: { install: EngineInstallRun | null }) {
  const t = useTranslations("engine");
  if (!install) return null;

  if (install.status === "running") {
    return (
      <AlertBanner variant="info" title={t("installRunning", { name: install.label })}>
        <AutoRefresh intervalMs={INSTALL_REFRESH_MS} />
        <span className="flex flex-col gap-1">
          <span>{t("installRunningBody")}</span>
          <span className="text-muted text-xs">
            {t("installStarted")} <RelativeTime value={install.startedAt} />
          </span>
        </span>
      </AlertBanner>
    );
  }

  const finished = install.finishedAt ? (
    <span className="text-muted text-xs">
      {t("installFinished")} <RelativeTime value={install.finishedAt} />
    </span>
  ) : null;

  if (install.status === "failed" || !install.report) {
    return (
      <AlertBanner
        variant="danger"
        title={t("installFailedTitle", { name: install.label })}
        dismissible
      >
        <span className="flex flex-col gap-1">
          <span>{install.error}</span>
          {finished}
        </span>
      </AlertBanner>
    );
  }

  const result = install.report;
  const shown = (items: string[]) =>
    items.slice(0, 8).join(", ") + (items.length > 8 ? ` (+${items.length - 8})` : "");

  return (
    <AlertBanner
      variant={result.missing.length > 0 || result.notice ? "warning" : "success"}
      title={t("reportTitle", { name: result.label })}
      dismissible
    >
      <span className="flex flex-col gap-1">
        <span>{t("reportWritten", { files: result.files, removed: result.removed })}</span>
        {result.missing.length > 0 ? (
          <span>{t("reportMissing", { files: shown(result.missing) })}</span>
        ) : null}
        {result.kept.length > 0 ? (
          <span>{t("reportKept", { files: shown(result.kept) })}</span>
        ) : null}
        {result.notice ? <span>{result.notice}</span> : null}
        {finished}
      </span>
    </AlertBanner>
  );
}
