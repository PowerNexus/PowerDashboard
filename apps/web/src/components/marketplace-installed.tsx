"use client";

import { MARKETPLACE_SOURCE_LABEL } from "@gamedashboard/contracts";
import { Badge, Button, Card, CardBody, CardHeader, RelativeTime } from "@gamedashboard/ui";
import { ArrowUpCircle, Check, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { InstalledExtension } from "@/server/api/marketplace";

/**
 * Extensions installées sur le serveur, indépendamment de la recherche.
 *
 * Les mises à jour viennent de la veille quotidienne de l'API : cette liste
 * n'interroge aucun catalogue, elle montre ce que la veille a relevé et quand.
 */
export function MarketplaceInstalled({
  installed,
  busy,
  onUpdate,
  onUpdateAll,
  onRemove,
}: {
  installed: InstalledExtension[];
  busy: boolean;
  onUpdate: (item: InstalledExtension, version: string) => void;
  onUpdateAll: () => void;
  onRemove: (item: InstalledExtension) => void;
}) {
  const t = useTranslations("marketplace");
  const tc = useTranslations("common");
  if (installed.length === 0) return null;

  const late = installed.filter((item) => item.latestVersion !== null).length;

  return (
    <Card>
      <CardHeader
        title={t("installedTitle", { count: installed.length })}
        description={late > 0 ? t("installedLate", { count: late }) : t("installedFresh")}
        actions={
          late > 1 ? (
            <Button size="sm" disabled={busy} onClick={onUpdateAll}>
              <ArrowUpCircle /> {t("updateAll")}
            </Button>
          ) : undefined
        }
      />
      <CardBody className="flex flex-col divide-y divide-border p-0">
        {installed.map((item) => (
          <div
            key={item.projectId}
            className="flex flex-wrap items-center justify-between gap-3 px-6 py-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-fg">{item.name}</p>
              <p className="text-xs text-muted">
                {MARKETPLACE_SOURCE_LABEL[item.source]} · {t("checked")}{" "}
                <RelativeTime value={item.checkedAt} fallback={t("neverChecked")} />
              </p>
            </div>
            <div className="flex items-center gap-2">
              {item.latestVersion ? (
                <>
                  <span className="gd-mono text-xs text-muted">
                    {item.version} → <span className="text-warning-ink">{item.latestVersion}</span>
                  </span>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => onUpdate(item, item.latestVersion as string)}
                  >
                    <ArrowUpCircle /> {t("update")}
                  </Button>
                </>
              ) : (
                <Badge variant="neutral">
                  <Check className="size-3" /> {item.version}
                </Badge>
              )}
              <Button
                size="sm"
                variant="danger-ghost"
                disabled={busy}
                aria-label={`${tc("remove")} ${item.name}`}
                onClick={() => onRemove(item)}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
