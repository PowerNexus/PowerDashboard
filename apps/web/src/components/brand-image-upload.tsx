"use client";

import type { BrandImageKind } from "@gamedashboard/contracts";
import { Button } from "@gamedashboard/ui";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, useTransition } from "react";
import { type BrandImageTarget, uploadBrandImage } from "@/server/api/brand-images";

/**
 * Envoi d'un logo ou d'un favicon par fichier, à côté du champ d'adresse.
 *
 * L'adresse reste possible : ce bouton ne fait que la remplir. Une fois
 * l'image rangée, l'API l'applique aussitôt à la marque et rend son chemin
 * interne (`/brand/fichier/<id>`), que `onUploaded` recopie dans le champ pour
 * que le formulaire affiche ce qui est réellement servi.
 */
export function BrandImageUpload({
  target,
  kind,
  disabled,
  onUploaded,
}: {
  target: BrandImageTarget;
  kind: BrandImageKind;
  disabled?: boolean;
  onUploaded: (url: string) => void;
}) {
  const t = useTranslations("brandImage");
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = (file: File) =>
    startTransition(async () => {
      const form = new FormData();
      form.set("file", file);
      const result = await uploadBrandImage(target, kind, form);
      setError(result.error);
      if (result.url) onUploaded(result.url);
    });

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || pending}
          onClick={() => input.current?.click()}
        >
          <Upload /> {pending ? t("uploading") : t("upload")}
        </Button>
        <span className="text-muted text-xs">{t("formats")}</span>
      </div>
      {/* Le champ natif reste caché, comme pour l'envoi de fichiers d'un serveur. */}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/x-icon,.ico"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) send(file);
          event.target.value = "";
        }}
      />
      {error ? (
        <p role="alert" className="text-danger-ink text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
