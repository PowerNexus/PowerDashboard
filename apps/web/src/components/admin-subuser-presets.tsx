"use client";

import {
  DELEGABLE_ROLE_PRESETS,
  type DelegableRolePreset,
  PERMISSION_GROUPS,
  type RolePresets,
  type RolePresetsView,
  type ServerPermission,
} from "@gamedashboard/contracts";
import {
  AlertBanner,
  Badge,
  Button,
  ConfirmDialog,
  FormField,
  PermissionMatrix,
  SelectMenu,
  SettingsSection,
} from "@gamedashboard/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { resetSubuserPresets, saveSubuserPresets } from "@/server/api/admin-actions";

/** Mêmes libellés que le formulaire d'invitation, qui les propose. */
const PRESET_LABELS: Record<DelegableRolePreset, string> = {
  viewer: "presetViewer",
  moderator: "presetModerator",
  developer: "presetDeveloper",
};

/**
 * Presets de sous-utilisateurs, redéfinis par l'administration (PLAN §5.2).
 *
 * Un seul preset à l'écran à la fois, choisi dans une liste : trois matrices
 * de quarante-cinq cases empilées rendraient la page illisible, et c'est
 * justement en comparant les cases qu'on se trompe.
 *
 * Le jeu entier part à l'enregistrement, pas le seul preset affiché : l'API
 * le valide d'un bloc, et un preset refusé ne laisse pas les autres à moitié
 * écrits.
 *
 * Le support voit les presets sans pouvoir les changer — l'API le refuserait.
 */
export function AdminSubuserPresets({
  initial,
  canEdit,
}: {
  initial: RolePresetsView;
  canEdit: boolean;
}) {
  const t = useTranslations("subuserPresets");
  const ts = useTranslations("subusers");
  const tc = useTranslations("common");
  const router = useRouter();
  const [selected, setSelected] = useState<DelegableRolePreset>("moderator");
  const [draft, setDraft] = useState<RolePresets>(initial.presets);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ error: string | null }>, next: RolePresets) =>
    startTransition(async () => {
      const result = await action();
      setError(result.error);
      setSaved(!result.error);
      if (!result.error) {
        setDraft(next);
        router.refresh();
      }
    });

  return (
    <SettingsSection
      id="reglages-presets"
      title={t("title")}
      description={t("description")}
      footer={
        canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={pending} onClick={() => run(() => saveSubuserPresets(draft), draft)}>
              {tc("save")}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirmReset(true)}>
              {t("reset")}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {/* Le point qui surprend, dit avant qu'on coche quoi que ce soit. */}
        <AlertBanner variant="info" title={t("existingTitle")}>
          {t("existingBody")}
        </AlertBanner>
        {error ? (
          <AlertBanner variant="danger" title={tc("refused")} dismissible>
            {error}
          </AlertBanner>
        ) : null}
        {saved ? (
          <AlertBanner variant="success" title={tc("saved")} dismissible>
            {t("savedBody")}
          </AlertBanner>
        ) : null}

        <FormField label={t("preset")}>
          {(id) => (
            <SelectMenu
              id={id}
              className="sm:max-w-xs"
              value={selected}
              onValueChange={(value) => setSelected(value as DelegableRolePreset)}
              options={DELEGABLE_ROLE_PRESETS.map((preset) => ({
                value: preset,
                label: ts(PRESET_LABELS[preset]),
                description: initial.customized.includes(preset) ? t("customized") : t("default"),
              }))}
            />
          )}
        </FormField>
        {initial.customized.includes(selected) ? (
          <Badge variant="warning">{t("customized")}</Badge>
        ) : null}

        <PermissionMatrix
          groups={PERMISSION_GROUPS}
          value={draft[selected]}
          disabled={!canEdit || pending}
          onChange={(permissions) =>
            setDraft((current) => ({
              ...current,
              [selected]: permissions as ServerPermission[],
            }))
          }
        />
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t("resetTitle")}
        description={t("resetBody")}
        confirmLabel={t("reset")}
        onConfirm={() => {
          setConfirmReset(false);
          run(resetSubuserPresets, initial.defaults);
        }}
      />
    </SettingsSection>
  );
}
