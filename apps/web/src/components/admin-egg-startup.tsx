"use client";

import { previewStartup } from "@gamedashboard/contracts";
import { CodeBlock, FormField, Input, SettingsSection } from "@gamedashboard/ui";
import { useTranslations } from "next-intl";
import type { EggDraftState } from "@/lib/use-egg-draft";
import { EggExample, EggTextArea } from "./admin-egg-fields";

/**
 * Démarrage : la commande lancée dans le conteneur, et celle qui l'arrête.
 *
 * L'aperçu remplace chaque variable par sa valeur par défaut : c'est la
 * commande qu'un serveur neuf exécutera. Ce que le panel calcule lui-même —
 * port, mémoire — reste entre accolades, puisqu'il dépend du serveur.
 */
export function AdminEggStartup({ state }: { state: EggDraftState }) {
  const t = useTranslations("adminEggEditor");
  const { draft, set, errorFor, pending } = state;
  const preview = previewStartup(draft.startup, draft.variables);

  return (
    <SettingsSection id="demarrage" title={t("startupTitle")} description={t("startupHint")}>
      <div className="flex flex-col gap-4">
        <FormField
          label={t("startup")}
          description={t("startupFieldHint")}
          error={errorFor("startup")}
        >
          {(id) => (
            <EggTextArea
              id={id}
              mono
              rows={3}
              value={draft.startup}
              disabled={pending}
              invalid={Boolean(errorFor("startup"))}
              onChange={(e) => set("startup", e.target.value)}
            />
          )}
        </FormField>
        <EggExample
          label={t("example")}
          value="java -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}"
        />

        <CodeBlock title={t("startupPreview")} code={preview || " "} />
        <p className="text-muted text-xs">{t("startupPreviewHint")}</p>

        <FormField label={t("stop")} description={t("stopHint")} error={errorFor("configStop")}>
          {(id) => (
            <Input
              id={id}
              className="gd-mono sm:max-w-xs"
              value={draft.configStop}
              disabled={pending}
              placeholder="stop"
              onChange={(e) => set("configStop", e.target.value)}
            />
          )}
        </FormField>
        <EggExample label={t("example")} value="stop · ^C · quit" />
      </div>
    </SettingsSection>
  );
}
