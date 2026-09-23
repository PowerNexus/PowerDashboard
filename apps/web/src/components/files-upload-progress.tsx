"use client";

import { Button, Progress } from "@gamedashboard/ui";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { EnvoiProgres } from "@/lib/file-upload";

/**
 * Progression d'un envoi découpé, avec de quoi l'arrêter.
 *
 * Elle n'apparaît que pour les envois découpés. Un petit fichier part en une
 * requête : y accrocher une barre la ferait clignoter sans rien apprendre. Ici
 * elle dit quelque chose de vrai — chaque pas est un morceau que le panel a
 * confirmé avoir reçu, et un envoi repris repart de ce compte-là.
 *
 * Le bouton d'annulation vit sur la barre, et non dans l'en-tête : c'est cet
 * envoi-là qu'il arrête, et il n'a de sens que tant qu'elle est affichée.
 */
export function FilesUploadProgress({
  progres,
  onCancel,
}: {
  progres: EnvoiProgres;
  onCancel: () => void;
}) {
  const t = useTranslations("files");
  const tf = useTranslations("fileTools");

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-4">
        <span className="truncate font-medium text-fg text-sm">{progres.nom}</span>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-muted text-xs tabular-nums">
            {t("uploadProgress", { done: progres.fait, total: progres.total })}
          </span>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <X /> {tf("cancelUpload")}
          </Button>
        </div>
      </div>
      <Progress value={progres.fait} max={progres.total} label={t("uploading")} />
    </div>
  );
}
