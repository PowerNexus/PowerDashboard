import { cn } from "../lib/cn";

export interface ProgressProps {
  value: number;
  max?: number;
  tone?: "accent" | "success" | "warning" | "danger";
  label?: string;
  className?: string;
}

const TONES = {
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function Progress({ value, max = 100, tone = "accent", label, className }: ProgressProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className={cn("h-1.5 overflow-hidden rounded-full bg-surface-3", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", TONES[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
