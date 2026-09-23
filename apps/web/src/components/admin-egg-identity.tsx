"use client";

import { FormField, Input, SettingsSection } from "@gamedashboard/ui";
import { useTranslations } from "next-intl";
import type { EggDraftState } from "@/lib/use-egg-draft";
import { EggTextArea } from "./admin-egg-fields";

/** Identité : ce que le client lit en choisissant un jeu. */
export function AdminEggIdentity({ state }: { state: EggDraftState }) {
  const t = useTranslations("adminEggEditor");
  const { draft, set, errorFor, pending } = state;

  return (
    <SettingsSection id="identite" title={t("identityTitle")} description={t("identityHint")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t("name")} description={t("nameHint")} error={errorFor("name")}>
          {(id) => (
            <Input
              id={id}
              value={draft.name}
              disabled={pending}
              invalid={Boolean(errorFor("name"))}
              placeholder="Minecraft Paper"
              onChange={(e) => set("name", e.target.value)}
            />
          )}
        </FormField>
        <FormField label={t("author")} description={t("authorHint")} error={errorFor("author")}>
          {(id) => (
            <Input
              id={id}
              value={draft.author}
              disabled={pending}
              placeholder="contact@exemple.fr"
              onChange={(e) => set("author", e.target.value)}
            />
          )}
        </FormField>
        <FormField
          className="sm:col-span-2"
          label={t("description")}
          description={t("descriptionHint")}
          error={errorFor("description")}
        >
          {(id) => (
            <EggTextArea
              id={id}
              rows={3}
              value={draft.description}
              disabled={pending}
              onChange={(e) => set("description", e.target.value)}
            />
          )}
        </FormField>
      </div>
    </SettingsSection>
  );
}
