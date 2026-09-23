"use client";

import {
  AlertBanner,
  Button,
  ConfirmDialog,
  SettingsSection,
  SettingToggle,
} from "@gamedashboard/ui";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { removeNode, setNodeMaintenance } from "@/server/api/admin-actions";
import type { AdminNodeDetail } from "@/server/api/admin-node";

/**
 * Zone dangereuse : maintenance et suppression.
 *
 * La maintenance n'est pas destructrice, mais elle a sa place ici parce
 * qu'elle change ce que vivent les clients : plus aucun serveur ne sera placé
 * sur la machine. La suppression dit, avant le clic, combien de serveurs la
 * bloquent — elle est refusée tant qu'il en reste un — et ce qu'elle emporte :
 * le jeton du daemon et les ports déclarés.
 */
export function AdminNodeDanger({ node }: { node: AdminNodeDetail }) {
  const t = useTranslations("nodeAdmin");
  const ta = useTranslations("adminNodes");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const toggleMaintenance = (enabled: boolean) =>
    startTransition(async () => {
      const result = await setNodeMaintenance(node.id, enabled);
      setError(result.error);
      if (!result.error) router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      const result = await removeNode(node.id);
      setError(result.error);
      if (!result.error) router.push("/admin/nodes");
    });

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <AlertBanner variant="danger" title={tc("actionRefused")} dismissible>
          {error}
        </AlertBanner>
      ) : null}

      <SettingsSection title={t("maintenanceTitle")} description={t("maintenanceHint")}>
        <SettingToggle
          label={t("maintenanceLabel")}
          description={t("maintenanceEffect", { count: node.servers })}
          checked={node.maintenance}
          disabled={pending}
          onCheckedChange={toggleMaintenance}
        />
      </SettingsSection>

      <SettingsSection
        tone="danger"
        title={ta("removeNode")}
        description={
          node.servers > 0 ? t("removeBlocked", { count: node.servers }) : ta("removeNodeBody")
        }
        footer={
          <Button
            variant="danger"
            disabled={pending || node.servers > 0}
            onClick={() => setConfirming(true)}
          >
            <Trash2 /> {ta("removeNode")}
          </Button>
        }
      >
        <p className="text-muted text-sm">{t("removeWhat")}</p>
      </SettingsSection>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={ta("removeNodeTitle", { name: node.name })}
        description={`${ta("removeNodeBody")} ${t("removeTypeName")}`}
        confirmLabel={ta("removeNodeConfirm")}
        cancelLabel={tc("cancel")}
        destructive
        requireTyped={node.name}
        loading={pending}
        onConfirm={remove}
      />
    </div>
  );
}
