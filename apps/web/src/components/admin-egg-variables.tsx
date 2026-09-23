"use client";

import { Button, EmptyState, SettingsSection } from "@gamedashboard/ui";
import { Plus, Variable } from "lucide-react";
import { useTranslations } from "next-intl";
import type { EggDraftState } from "@/lib/use-egg-draft";
import type { AdminEggVariable } from "@/server/api/admin";
import { AdminEggVariable as VariableCard } from "./admin-egg-variable";

/**
 * Variables : les réglages que l'egg expose, avec leur valeur par défaut et
 * leurs règles. Chacune devient une variable d'environnement du conteneur, et
 * peut être citée dans la commande de démarrage.
 */
export function AdminEggVariables({
  state,
  stored,
}: {
  state: EggDraftState;
  /** Les variables en base, pour savoir lesquelles des serveurs emploient. */
  stored: AdminEggVariable[];
}) {
  const t = useTranslations("adminEggEditor");
  const usage = new Map(stored.map((variable) => [variable.id, variable.servers]));

  return (
    <SettingsSection
      id="variables"
      title={t("variablesTitle")}
      description={t("variablesHint")}
      footer={
        <Button variant="secondary" size="sm" disabled={state.pending} onClick={state.addVariable}>
          <Plus /> {t("variableAdd")}
        </Button>
      }
    >
      {state.draft.variables.length === 0 ? (
        <EmptyState
          icon={<Variable />}
          title={t("variablesEmpty")}
          description={t("variablesEmptyHint")}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {state.draft.variables.map((variable, index) => (
            <VariableCard
              // Une variable neuve n'a pas d'identifiant : sa position en tient lieu.
              key={variable.id ?? `nouvelle-${index}`}
              state={state}
              index={index}
              variable={variable}
              servers={variable.id ? (usage.get(variable.id) ?? 0) : 0}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
