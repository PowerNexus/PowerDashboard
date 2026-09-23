"use client";

import { NODE_STATUS_TONE, type NodeStatus, nodeStatus } from "@gamedashboard/contracts";
import { Badge, RelativeTime, StatusDot } from "@gamedashboard/ui";
import { useTranslations } from "next-intl";

/**
 * L'état d'une machine, dit en clair : l'étiquette, **depuis quand**, et ce que
 * cela veut dire pour ses serveurs.
 *
 * L'état n'est pas une valeur reçue mais une conclusion tirée de l'âge du
 * dernier contact (`nodeStatus`). Une machine jamais jointe est « injoignable »
 * par la même règle — mais le dire ainsi à qui vient de la déclarer
 * l'inquiéterait à tort : on lui dit plutôt qu'elle attend l'installation de
 * Wings.
 */
export interface NodeHealthView {
  maintenance: boolean;
  lastHeartbeatAt: string | null;
}

export function nodeStatusAt(node: NodeHealthView, now?: number): NodeStatus {
  return nodeStatus(
    {
      maintenance: node.maintenance,
      lastHeartbeatAt: node.lastHeartbeatAt ?? new Date(0).toISOString(),
    },
    now,
  );
}

export function NodeStatusLine({
  node,
  now,
  detailed = false,
}: {
  node: NodeHealthView;
  /** Horloge de la page, pour que l'état vieillisse entre deux rafraîchissements. */
  now?: number;
  /** Ajoute la phrase qui explique la conséquence de l'état. */
  detailed?: boolean;
}) {
  const t = useTranslations("nodeAdmin");
  const ts = useTranslations("nodeStatus");
  const state = nodeStatusAt(node, now);
  const neverSeen = node.lastHeartbeatAt === null;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <StatusDot
          tone={NODE_STATUS_TONE[state]}
          pulse={state === "stale" || state === "maintenance"}
          label={ts(state)}
        />
        <Badge variant={NODE_STATUS_TONE[state]}>
          {neverSeen ? t("statusNeverSeen") : ts(state)}
        </Badge>
        <span className="text-muted text-xs">
          {neverSeen ? (
            t("lastContactNever")
          ) : (
            <>
              {t("lastContact")} <RelativeTime value={node.lastHeartbeatAt} />
            </>
          )}
        </span>
      </span>
      {detailed ? (
        <p className="text-muted text-xs">
          {neverSeen ? t("reasonNeverSeen") : t(`reason.${state}`)}
        </p>
      ) : null}
    </div>
  );
}
