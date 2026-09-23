"use client";

import { FormField, Input, SettingsSection } from "@gamedashboard/ui";
import { useTranslations } from "next-intl";
import type { EggDraftState } from "@/lib/use-egg-draft";
import { CodeEditor } from "./code-editor";

/**
 * Installation : le script lancé une fois, à la création ou à la
 * réinstallation d'un serveur, dans un conteneur à part.
 */
export function AdminEggInstall({ state }: { state: EggDraftState }) {
  const t = useTranslations("adminEggEditor");
  const { draft, set, errorFor, pending } = state;

  return (
    <SettingsSection id="installation" title={t("installTitle")} description={t("installHint")}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <FormField
            label={t("installContainer")}
            description={t("installContainerHint")}
            error={errorFor("installContainer")}
          >
            {(id) => (
              <Input
                id={id}
                className="gd-mono"
                value={draft.installContainer}
                disabled={pending}
                invalid={Boolean(errorFor("installContainer"))}
                placeholder="ghcr.io/pterodactyl/installers:debian"
                onChange={(e) => set("installContainer", e.target.value)}
              />
            )}
          </FormField>
          <FormField
            label={t("installEntrypoint")}
            description={t("installEntrypointHint")}
            error={errorFor("installEntrypoint")}
          >
            {(id) => (
              <Input
                id={id}
                className="gd-mono"
                value={draft.installEntrypoint}
                disabled={pending}
                invalid={Boolean(errorFor("installEntrypoint"))}
                placeholder="bash"
                onChange={(e) => set("installEntrypoint", e.target.value)}
              />
            )}
          </FormField>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="font-semibold text-fg text-sm">{t("installScript")}</p>
          <CodeEditor
            language="shell"
            height={360}
            readOnly={pending}
            value={draft.installScript}
            onChange={(value) => set("installScript", value)}
          />
          <p
            className={errorFor("installScript") ? "text-danger-ink text-xs" : "text-muted text-xs"}
          >
            {errorFor("installScript") ?? t("installScriptHint")}
          </p>
        </div>
      </div>
    </SettingsSection>
  );
}
