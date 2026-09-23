"use client";

import { Button, FormField, SettingsSection } from "@gamedashboard/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { EggDraftState } from "@/lib/use-egg-draft";
import { EggExample, EggTextArea } from "./admin-egg-fields";
import { CodeEditor } from "./code-editor";

const JSON_BLOCKS = [
  { key: "configStartup", example: '{ "done": ")! For help, type " }' },
  {
    key: "configFiles",
    example: '{ "server.properties": { "parser": "properties", "find": { … } } }',
  },
  { key: "configLogs", example: "{}" },
] as const;

const LISTS = [
  { key: "features", example: "eula" },
  { key: "fileDenylist", example: "*.jar.old" },
] as const;

/**
 * Configuration avancée, repliée par défaut.
 *
 * Ces blocs sont lus par Wings tels quels : détection du démarrage, fichiers
 * réécrits à chaque lancement, journaux. La plupart des eggs importés les
 * portent déjà correctement, et les montrer d'emblée inviterait à y toucher.
 * La section s'ouvre d'elle-même quand l'un d'eux est fautif.
 */
export function AdminEggAdvanced({ state }: { state: EggDraftState }) {
  const t = useTranslations("adminEggEditor");
  const { draft, set, errorFor, pending, problems } = state;
  const faulty = problems.some((p) => /^(config|features|fileDenylist)/.test(p.path));
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState(() => ({
    features: draft.features.join("\n"),
    fileDenylist: draft.fileDenylist.join("\n"),
  }));
  const shown = open || faulty;

  return (
    <SettingsSection
      id="avance"
      title={t("advancedTitle")}
      description={t("advancedHint")}
      actions={
        <Button variant="ghost" size="sm" aria-expanded={shown} onClick={() => setOpen(!shown)}>
          {shown ? <ChevronDown /> : <ChevronRight />} {shown ? t("collapse") : t("expand")}
        </Button>
      }
    >
      {shown ? (
        <div className="flex flex-col gap-5">
          {JSON_BLOCKS.map(({ key, example }) => (
            <div key={key} className="flex flex-col gap-1.5">
              <p className="font-semibold text-fg text-sm">{t(`${key}Label`)}</p>
              <p className="text-muted text-xs">{t(`${key}Hint`)}</p>
              <CodeEditor
                language="json"
                height={180}
                readOnly={pending}
                value={draft[key]}
                onChange={(value) => set(key, value)}
              />
              {errorFor(key) ? <p className="text-danger-ink text-xs">{errorFor(key)}</p> : null}
              <EggExample label={t("example")} value={example} />
            </div>
          ))}

          <div className="grid gap-4 sm:grid-cols-2">
            {LISTS.map(({ key, example }) => (
              <FormField
                key={key}
                label={t(`${key}Label`)}
                description={t(`${key}Hint`)}
                error={errorFor(key)}
              >
                {(id) => (
                  <EggTextArea
                    id={id}
                    mono
                    rows={4}
                    value={lists[key]}
                    disabled={pending}
                    placeholder={example}
                    onChange={(e) => {
                      setLists((current) => ({ ...current, [key]: e.target.value }));
                      set(
                        key,
                        e.target.value
                          .split("\n")
                          .map((line) => line.trim())
                          .filter((line) => line !== ""),
                      );
                    }}
                  />
                )}
              </FormField>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-muted text-sm">{t("advancedCollapsed")}</p>
      )}
    </SettingsSection>
  );
}
