"use client";

import { Badge, Button, Card, CardBody, FormField, Input, SettingToggle } from "@gamedashboard/ui";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { EggDraftState, EggVariableDraft } from "@/lib/use-egg-draft";
import { EggExample, EggTextArea } from "./admin-egg-fields";

/** Exemples de règles, du plus courant au plus précis. */
const RULE_EXAMPLES = [
  "required|string|max:20",
  "nullable|integer|between:1,100",
  "required|in:vanilla,paper,fabric",
  "required|regex:/^[a-z0-9_]+$/",
];

/**
 * Une variable de l'egg.
 *
 * Une variable **employée** (des serveurs lui ont une valeur) ne se renomme ni
 * ne se supprime : l'API le refuserait, et l'écran le dit avant qu'on essaie.
 * La cacher au client reste possible, et c'est ce qu'on propose à la place.
 */
export function AdminEggVariable({
  state,
  index,
  variable,
  servers,
}: {
  state: EggDraftState;
  index: number;
  variable: EggVariableDraft;
  /** Serveurs qui ont une valeur pour cette variable. */
  servers: number;
}) {
  const t = useTranslations("adminEggEditor");
  const { setVariable, removeVariable, errorFor, pending } = state;
  const at = (field: string) => errorFor(`variables.${index}.${field}`);
  const used = servers > 0;

  return (
    <Card>
      <CardBody className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 truncate font-semibold text-fg">
            {variable.name || t("variableUnnamed")}
          </p>
          {variable.id === null ? <Badge variant="info">{t("variableNew")}</Badge> : null}
          <Badge variant={used ? "accent" : "neutral"}>
            {t("variableServers", { count: servers })}
          </Badge>
          <Button
            variant="danger-ghost"
            size="sm"
            disabled={pending || used}
            title={used ? t("variableInUse") : undefined}
            onClick={() => removeVariable(index)}
          >
            <Trash2 /> {t("remove")}
          </Button>
        </div>
        {used ? <p className="text-muted text-xs">{t("variableInUse")}</p> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t("variableName")}
            description={t("variableNameHint")}
            error={at("name")}
          >
            {(id) => (
              <Input
                id={id}
                value={variable.name}
                disabled={pending}
                invalid={Boolean(at("name"))}
                placeholder="Version du jeu"
                onChange={(e) => setVariable(index, { name: e.target.value })}
              />
            )}
          </FormField>
          <FormField
            label={t("variableEnv")}
            description={used && variable.id ? t("variableEnvLocked") : t("variableEnvHint")}
            error={at("envVariable")}
          >
            {(id) => (
              <Input
                id={id}
                className="gd-mono"
                value={variable.envVariable}
                disabled={pending || (used && variable.id !== null)}
                invalid={Boolean(at("envVariable"))}
                placeholder="GAME_VERSION"
                onChange={(e) => setVariable(index, { envVariable: e.target.value.toUpperCase() })}
              />
            )}
          </FormField>
          <FormField
            className="sm:col-span-2"
            label={t("variableDescription")}
            description={t("variableDescriptionHint")}
            error={at("description")}
          >
            {(id) => (
              <EggTextArea
                id={id}
                rows={2}
                value={variable.description}
                disabled={pending}
                onChange={(e) => setVariable(index, { description: e.target.value })}
              />
            )}
          </FormField>
          <FormField
            label={t("variableDefault")}
            description={t("variableDefaultHint")}
            error={at("defaultValue")}
          >
            {(id) => (
              <Input
                id={id}
                className="gd-mono"
                value={variable.defaultValue}
                disabled={pending}
                invalid={Boolean(at("defaultValue"))}
                onChange={(e) => setVariable(index, { defaultValue: e.target.value })}
              />
            )}
          </FormField>
          <FormField
            label={t("variableRules")}
            description={t("variableRulesHint")}
            error={at("rules")}
          >
            {(id) => (
              <Input
                id={id}
                className="gd-mono"
                value={variable.rules}
                disabled={pending}
                invalid={Boolean(at("rules"))}
                placeholder="required|string|max:20"
                onChange={(e) => setVariable(index, { rules: e.target.value })}
              />
            )}
          </FormField>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {RULE_EXAMPLES.map((example) => (
            <EggExample key={example} label={t("example")} value={example} />
          ))}
        </div>

        <div className="divide-y divide-border">
          <SettingToggle
            label={t("variableViewable")}
            description={t("variableViewableHint")}
            checked={variable.userViewable}
            disabled={pending}
            onCheckedChange={(next) =>
              // Cacher une variable la ferme aussi à l'écriture : un champ
              // modifiable mais invisible serait refusé par l'API.
              setVariable(
                index,
                next ? { userViewable: true } : { userViewable: false, userEditable: false },
              )
            }
          />
          <SettingToggle
            label={t("variableEditable")}
            description={at("userEditable") ?? t("variableEditableHint")}
            checked={variable.userEditable}
            disabled={pending || !variable.userViewable}
            onCheckedChange={(next) => setVariable(index, { userEditable: next })}
          />
        </div>
      </CardBody>
    </Card>
  );
}
