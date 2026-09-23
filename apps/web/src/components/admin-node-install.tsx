"use client";

import {
  AlertBanner,
  Button,
  ConfirmDialog,
  KeyValueGrid,
  RelativeTime,
  SettingsSection,
} from "@gamedashboard/ui";
import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { rotateNodeToken } from "@/server/api/admin-actions";
import type { AdminNodeDetail } from "@/server/api/admin-node";
import { AdminNodeConfigure } from "./admin-node-configure";

/**
 * Installation de Wings et jeton du daemon.
 *
 * Deux blocs qui se ressemblent et qu'il faut distinguer : la **clé
 * d'amorçage** de la commande `wings configure` sert une fois, pour aller
 * chercher la configuration ; le **jeton du daemon** est ce qu'on y trouve, et
 * il lie la machine au panel dans les deux sens. Le remplacer est sûr — le
 * panel ne retient le nouveau que si le daemon l'a confirmé — mais la fenêtre
 * le dit avant le clic, parce qu'un bouton qui peut couper une machine fait
 * hésiter sans cette phrase.
 */
export function AdminNodeInstall({
  node,
  panelOrigin,
}: {
  node: AdminNodeDetail;
  panelOrigin: string;
}) {
  const t = useTranslations("nodeAdmin");
  const ta = useTranslations("adminNodes");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotated, setRotated] = useState(false);

  const rotate = () =>
    startTransition(async () => {
      setConfirming(false);
      const result = await rotateNodeToken(node.id);
      setError(result.error);
      setRotated(result.applied);
      if (result.applied) router.refresh();
    });

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t("installTitle")} description={t("installHint")}>
        <AdminNodeConfigure node={{ id: node.id, name: node.name }} panelOrigin={panelOrigin} />
      </SettingsSection>

      <SettingsSection
        title={t("tokenTitle")}
        description={t("tokenHint")}
        footer={
          <Button variant="secondary" disabled={pending} onClick={() => setConfirming(true)}>
            <KeyRound /> {ta("rotateToken")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <KeyValueGrid
            items={[
              { label: t("tokenId"), value: <span className="gd-mono">{node.tokenId}</span> },
              { label: t("tokenRotatedAt"), value: <RelativeTime value={node.tokenRotatedAt} /> },
            ]}
          />
          {error ? (
            <AlertBanner variant="danger" title={t("tokenNotRotated")}>
              {error}
            </AlertBanner>
          ) : null}
          {rotated ? <AlertBanner variant="success">{t("tokenRotated")}</AlertBanner> : null}
        </div>
      </SettingsSection>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={ta("rotateTokenTitle", { name: node.name })}
        description={`${ta("rotateTokenHint")} ${ta("rotateTokenBody")}`}
        confirmLabel={ta("rotateTokenConfirm")}
        cancelLabel={tc("cancel")}
        loading={pending}
        onConfirm={rotate}
      />
    </div>
  );
}
