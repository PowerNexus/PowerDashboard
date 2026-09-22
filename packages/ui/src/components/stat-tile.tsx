import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "accent" | "success" | "warning" | "danger";
  className?: string;
}

const TONES = {
  default: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success-ink",
  warning: "bg-warning-soft text-warning-ink",
  danger: "bg-danger-soft text-danger-ink",
};

/** Tuile KPI : label, grande valeur, icône ronde, indication secondaire. */
export function StatTile({ label, value, icon, hint, tone = "default", className }: StatTileProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 rounded-card border border-border bg-surface px-5 py-4 shadow-card",
        className,
      )}
    >
      {icon ? (
        <span
          className={cn(
            "inline-flex size-11 shrink-0 items-center justify-center rounded-full [&_svg]:size-5",
            TONES[tone],
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
        <p className="truncate text-2xl font-semibold leading-tight text-fg">{value}</p>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
    </div>
  );
}

export interface MetricBarProps {
  label: ReactNode;
  /** `null` quand la mesure est inconnue (source injoignable). Ce n'est pas zéro. */
  value: number | null;
  max?: number;
  format?: (v: number) => string;
  tone?: "accent" | "success" | "warning" | "danger" | "auto";
  /** Texte affiché à la place de la valeur quand elle est inconnue. */
  unknownLabel?: string;
  className?: string;
}

/** Barre de ressource « 2.1 GB / 4 GB ». `tone: auto` colore selon le pourcentage. */
export function MetricBar({
  label,
  value,
  max,
  format = String,
  tone = "auto",
  unknownLabel = "Inconnu",
  className,
}: MetricBarProps) {
  if (value === null) {
    return (
      <div className={cn("flex flex-col gap-1.5", className)}>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate font-semibold text-muted">{label}</span>
          <span className="shrink-0 whitespace-nowrap text-faint">
            {unknownLabel}
            {max !== undefined ? <span className="gd-mono"> / {format(max)}</span> : null}
          </span>
        </div>
        {/* Hachures : la capacité est connue, l'occupation ne l'est pas. */}
        <div
          role="img"
          aria-label={String(unknownLabel)}
          className="h-1.5 rounded-full bg-surface-3 opacity-70 [background-image:repeating-linear-gradient(45deg,transparent,transparent_3px,var(--gd-border-strong)_3px,var(--gd-border-strong)_6px)]"
        />
      </div>
    );
  }
  const pct = max && max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const auto = pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warning" : "bg-accent";
  const color =
    tone === "auto"
      ? auto
      : { accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[
          tone
        ];
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-semibold text-muted">{label}</span>
        <span className="gd-mono shrink-0 whitespace-nowrap text-fg">
          {format(value)}
          {max !== undefined ? <span className="text-faint"> / {format(max)}</span> : null}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
