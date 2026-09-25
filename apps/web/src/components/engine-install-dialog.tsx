"use client";

import { Button, Dialog, DialogContent, SettingToggle } from "@gamedashboard/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/**
 * La confirmation d'un changement de moteur, avec la sauvegarde préalable.
 *
 * La sauvegarde est une sauvegarde **ordinaire** du panel — même quota, même
 * liste, même restauration — lancée par l'API serveur arrêté, et attendue
 * avant la première écriture. Cochée d'office pour un modpack, qui écrase une
 * arborescence ; décochée pour un jar, qui ne remplace qu'un fichier.
 *
 * Le texte dit ce qui est écrasé, et ce qui ne l'est pas : il diffère entre
 * une première installation, une mise à jour de pack, et une plateforme.
 */
export function EngineInstallDialog({
  open,
  title,
  kind,
  update,
  eulaApplicable,
  canBackup,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  kind: "jar" | "pack";
  /** Mise à jour du pack en place, et non première installation. */
  update: boolean;
  eulaApplicable: boolean;
  /** Le quota de sauvegardes du serveur n'est pas nul. */
  canBackup: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (backupFirst: boolean) => void;
}) {
  const t = useTranslations("engine");
  const tc = useTranslations("common");
  const [backupFirst, setBackupFirst] = useState(kind === "pack" && canBackup);

  // Chaque ouverture repart du choix conseillé pour ce qu'on installe.
  useEffect(() => {
    if (open) setBackupFirst(kind === "pack" && canBackup);
  }, [open, kind, canBackup]);

  const body =
    kind === "jar" ? t("confirmJarBody") : update ? t("confirmUpdateBody") : t("confirmPackBody");

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onCancel()}>
      <DialogContent
        size="md"
        title={title}
        description={body}
        footer={
          <>
            <Button variant="secondary" onClick={onCancel}>
              {tc("cancel")}
            </Button>
            <Button variant="danger" loading={pending} onClick={() => onConfirm(backupFirst)}>
              {update ? t("update") : t("install")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          {kind === "pack" ? <p className="text-muted">{t("preservedBody")}</p> : null}
          {kind === "pack" ? <p className="text-muted">{t("loaderBody")}</p> : null}
          {canBackup ? (
            <SettingToggle
              label={t("backupFirst")}
              description={t("backupFirstHint")}
              checked={backupFirst}
              onCheckedChange={setBackupFirst}
            />
          ) : (
            <p className="text-muted">{t("backupUnavailable")}</p>
          )}
          {eulaApplicable ? <p className="text-muted">{t("confirmEulaReset")}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
