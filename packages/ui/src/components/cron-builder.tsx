"use client";

import { cn } from "../lib/cn";
import { Input } from "./input";

export interface CronValue {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

export interface CronBuilderProps {
  value: CronValue;
  onChange: (v: CronValue) => void;
  /**
   * Libellés des cinq champs, pour les applications traduites.
   *
   * Les indications numériques (0-59, 1-12…) n'en font pas partie : elles ne
   * dépendent pas de la langue.
   */
  fieldLabels?: Partial<Record<keyof CronValue, string>>;
  /** Raccourcis proposés. Remplacent CRON_PRESETS quand ils sont fournis. */
  presets?: readonly CronPreset[];
  className?: string;
}

export interface CronPreset {
  label: string;
  value: CronValue;
}

const FIELDS: { key: keyof CronValue; label: string; hint: string }[] = [
  { key: "minute", label: "Minute", hint: "0-59" },
  { key: "hour", label: "Heure", hint: "0-23" },
  { key: "dayOfMonth", label: "Jour du mois", hint: "1-31" },
  { key: "month", label: "Mois", hint: "1-12" },
  { key: "dayOfWeek", label: "Jour semaine", hint: "0-6" },
];

export const CRON_PRESETS: readonly CronPreset[] = [
  { label: "Toutes les heures", value: cron("0", "*", "*", "*", "*") },
  { label: "Chaque jour à 4h", value: cron("0", "4", "*", "*", "*") },
  { label: "Chaque lundi à 3h", value: cron("0", "3", "*", "*", "1") },
  { label: "Toutes les 15 min", value: cron("*/15", "*", "*", "*", "*") },
];

function cron(
  minute: string,
  hour: string,
  dayOfMonth: string,
  month: string,
  dayOfWeek: string,
): CronValue {
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

export function cronToString(v: CronValue): string {
  return `${v.minute} ${v.hour} ${v.dayOfMonth} ${v.month} ${v.dayOfWeek}`;
}

/** Description lisible d'une expression cron simple. */
export function describeCron(v: CronValue): string {
  const s = cronToString(v);
  const preset = CRON_PRESETS.find((p) => cronToString(p.value) === s);
  if (preset) return preset.label;
  if (v.minute.startsWith("*/")) return `Toutes les ${v.minute.slice(2)} minutes`;
  if (v.hour === "*") return `À la minute ${v.minute} de chaque heure`;
  return `À ${v.hour.padStart(2, "0")}h${v.minute.padStart(2, "0")}`;
}

/** Cinq champs cron + raccourcis, avec l'expression brute toujours visible. */
export function CronBuilder({
  value,
  onChange,
  fieldLabels,
  presets = CRON_PRESETS,
  className,
}: CronBuilderProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => {
          const active = cronToString(p.value) === cronToString(value);
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.value)}
              className={cn(
                "cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                active
                  ? "bg-accent-soft text-accent"
                  : "bg-surface-2 text-muted hover:bg-surface-3 hover:text-fg",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-5">
        {FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <label htmlFor={`cron-${f.key}`} className="text-xs font-semibold text-muted">
              {fieldLabels?.[f.key] ?? f.label}
            </label>
            <Input
              id={`cron-${f.key}`}
              value={value[f.key]}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
              className="gd-mono text-center"
              placeholder={f.hint}
            />
            <span className="text-center text-[10px] text-faint">{f.hint}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-4 rounded-field bg-surface-2 px-4 py-2.5">
        <span className="gd-mono text-sm text-fg">{cronToString(value)}</span>
        <span className="text-xs text-muted">{describeCron(value)}</span>
      </div>
    </div>
  );
}
