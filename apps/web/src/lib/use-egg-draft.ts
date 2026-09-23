"use client";

import { type EggDraft, type EggDraftProblem, eggDraftProblems } from "@gamedashboard/contracts";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState, useTransition } from "react";
import type { AdminEggDetail } from "@/server/api/admin";
import { saveEgg } from "@/server/api/admin-actions";

export type EggVariableDraft = EggDraft["variables"][number];

/** Un bloc de configuration, montré en JSON lisible. `{}` reste `{}`. */
function jsonText(value: unknown): string {
  if (value === null || value === undefined) return "{}";
  const text = JSON.stringify(value, null, 2);
  return text === "{}" ? "{}" : text;
}

/** Le brouillon de l'éditeur, tiré de l'egg tel que l'API le rend. */
export function draftFromEgg(egg: AdminEggDetail): EggDraft {
  return {
    name: egg.name,
    description: egg.description ?? "",
    author: egg.author ?? "",
    dockerImages: Object.entries(egg.dockerImages).map(([label, image]) => ({ label, image })),
    startup: egg.startup,
    configStop: egg.configStop ?? "",
    configStartup: jsonText(egg.configStartup),
    configFiles: jsonText(egg.configFiles),
    configLogs: jsonText(egg.configLogs),
    installContainer: egg.installContainer,
    installEntrypoint: egg.installEntrypoint,
    installScript: egg.installScript,
    features: egg.features,
    fileDenylist: egg.fileDenylist,
    variables: egg.variables.map((variable) => ({
      id: variable.id,
      name: variable.name,
      envVariable: variable.envVariable,
      description: variable.description ?? "",
      defaultValue: variable.defaultValue,
      userViewable: variable.userViewable,
      userEditable: variable.userEditable,
      rules: variable.rules,
    })),
  };
}

/** Une variable neuve : visible, non modifiable, règle la plus courante. */
const NEW_VARIABLE: EggVariableDraft = {
  id: null,
  name: "",
  envVariable: "",
  description: "",
  defaultValue: "",
  userViewable: true,
  userEditable: false,
  rules: "nullable|string",
};

/**
 * État de l'éditeur d'egg : brouillon, défauts par champ, enregistrement.
 *
 * Les défauts viennent du **même schéma** que celui de l'API
 * (`eggDraftProblems`) : l'écran ne peut pas accepter ce que l'API refusera,
 * ni l'inverse. Ils ne s'affichent qu'après une première tentative
 * d'enregistrement — une variable qu'on vient d'ajouter est forcément vide, et
 * la couvrir de rouge avant qu'on ait tapé un caractère ne dirait rien d'utile.
 */
export function useEggDraft(egg: AdminEggDetail) {
  const t = useTranslations("adminEggEditor");
  const router = useRouter();
  const [draft, setDraft] = useState<EggDraft>(() => draftFromEgg(egg));
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const problems = useMemo(() => eggDraftProblems(draft), [draft]);

  const message = useCallback(
    (problem: EggDraftProblem) => t(`problems.${problem.code}`, problem.params),
    [t],
  );

  /** Le défaut d'un champ, traduit, ou `undefined`. */
  const errorFor = useCallback(
    (path: string): string | undefined => {
      if (!attempted) return undefined;
      const problem = problems.find((entry) => entry.path === path);
      return problem ? message(problem) : undefined;
    },
    [attempted, problems, message],
  );

  const set = useCallback(<K extends keyof EggDraft>(key: K, value: EggDraft[K]) => {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const setVariable = useCallback((index: number, patch: Partial<EggVariableDraft>) => {
    setSaved(false);
    setDraft((current) => ({
      ...current,
      variables: current.variables.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    }));
  }, []);

  const addVariable = useCallback(() => {
    setDraft((current) => ({ ...current, variables: [...current.variables, NEW_VARIABLE] }));
  }, []);

  const removeVariable = useCallback((index: number) => {
    setDraft((current) => ({
      ...current,
      variables: current.variables.filter((_, i) => i !== index),
    }));
  }, []);

  /** Enregistre, ou montre les défauts. Rend `false` si rien n'est parti. */
  const save = useCallback(() => {
    setAttempted(true);
    setSaved(false);
    if (problems.length > 0) {
      setError(t("fixFields", { count: problems.length }));
      return false;
    }
    startTransition(async () => {
      const result = await saveEgg(egg.id, draft);
      setError(result.error);
      setSaved(result.error === null);
      if (!result.error) router.refresh();
    });
    return true;
  }, [draft, egg.id, problems.length, router, t]);

  const reset = useCallback(() => {
    setDraft(draftFromEgg(egg));
    setAttempted(false);
    setError(null);
  }, [egg]);

  return {
    draft,
    set,
    setVariable,
    addVariable,
    removeVariable,
    errorFor,
    problems: attempted ? problems : [],
    save,
    reset,
    pending,
    error,
    saved,
  };
}

export type EggDraftState = ReturnType<typeof useEggDraft>;
