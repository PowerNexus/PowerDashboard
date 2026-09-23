"use client";

import { AlertBanner, Badge, Button, Input, SettingsSection } from "@gamedashboard/ui";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { EggDraftState } from "@/lib/use-egg-draft";
import { EggExample } from "./admin-egg-fields";

/**
 * Images Docker proposées. La première est celle d'un serveur neuf ; le
 * client choisit parmi les autres dans ses réglages de démarrage.
 */
export function AdminEggImages({ state }: { state: EggDraftState }) {
  const t = useTranslations("adminEggEditor");
  const { draft, set, errorFor, pending } = state;
  const images = draft.dockerImages;

  const update = (index: number, patch: Partial<(typeof images)[number]>) =>
    set(
      "dockerImages",
      images.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );

  return (
    <SettingsSection
      id="images"
      title={t("imagesTitle")}
      description={t("imagesHint")}
      footer={
        <Button
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => set("dockerImages", [...images, { label: "", image: "" }])}
        >
          <Plus /> {t("imageAdd")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {errorFor("dockerImages") ? (
          <AlertBanner variant="danger">{errorFor("dockerImages")}</AlertBanner>
        ) : null}
        {images.map((entry, index) => {
          const labelError = errorFor(`dockerImages.${index}.label`);
          const imageError = errorFor(`dockerImages.${index}.image`);
          return (
            // L'index sert de clé : deux lignes neuves sont identiques, et
            // rien d'autre ne les distingue tant qu'on ne les a pas remplies.
            // biome-ignore lint/suspicious/noArrayIndexKey: voir ci-dessus.
            <div key={index} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="w-full sm:w-44"
                  aria-label={t("imageLabel")}
                  placeholder="Java 21"
                  value={entry.label}
                  disabled={pending}
                  invalid={Boolean(labelError)}
                  onChange={(e) => update(index, { label: e.target.value })}
                />
                <Input
                  className="gd-mono min-w-56 flex-1"
                  aria-label={t("imageRef")}
                  placeholder="ghcr.io/pterodactyl/yolks:java_21"
                  value={entry.image}
                  disabled={pending}
                  invalid={Boolean(imageError)}
                  onChange={(e) => update(index, { image: e.target.value })}
                />
                {index === 0 ? <Badge variant="accent">{t("imageDefault")}</Badge> : null}
                <Button
                  variant="danger-ghost"
                  size="sm"
                  disabled={pending || images.length === 1}
                  onClick={() =>
                    set(
                      "dockerImages",
                      images.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 /> {t("remove")}
                </Button>
              </div>
              {labelError || imageError ? (
                <p className="text-danger-ink text-xs">{labelError ?? imageError}</p>
              ) : null}
            </div>
          );
        })}
        <EggExample label={t("example")} value="Java 21 → ghcr.io/pterodactyl/yolks:java_21" />
      </div>
    </SettingsSection>
  );
}
