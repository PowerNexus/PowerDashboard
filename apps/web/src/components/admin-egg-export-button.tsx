"use client";

import { Button, type ButtonProps } from "@gamedashboard/ui";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { exportEgg } from "@/server/api/admin-actions";

/**
 * Télécharge l'egg au format d'import Pterodactyl.
 *
 * Le fichier est fabriqué dans le navigateur à partir de la réponse : il n'y a
 * donc ni page intermédiaire ni lien à copier, et le nom proposé est celui que
 * Pterodactyl donnerait (`egg-<nom>.json`).
 */
export function AdminEggExportButton({
  eggId,
  variant = "secondary",
  size,
}: {
  eggId: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const t = useTranslations("adminEggEditor");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const download = () =>
    startTransition(async () => {
      const result = await exportEgg(eggId);
      setError(result.error);
      if (result.error) return;

      const url = URL.createObjectURL(new Blob([result.content], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
    });

  return (
    <Button
      variant={variant}
      size={size}
      loading={pending}
      onClick={download}
      title={error ?? t("exportHint")}
      aria-invalid={error ? true : undefined}
    >
      <Download /> {error ? t("exportFailed") : t("export")}
    </Button>
  );
}
