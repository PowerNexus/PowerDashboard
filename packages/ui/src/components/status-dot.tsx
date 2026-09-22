import { cn } from "../lib/cn";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<StatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-faint",
};

export interface StatusDotProps {
  tone: StatusTone;
  pulse?: boolean;
  className?: string;
  label?: string;
}

/** Pastille d'état : rouge Offline, vert Online, orange transition. */
export function StatusDot({ tone, pulse, className, label }: StatusDotProps) {
  return (
    <span
      className={cn("relative inline-flex size-2 shrink-0", className)}
      role="img"
      aria-label={label}
    >
      {pulse ? (
        <span
          className={cn("absolute inset-0 animate-ping rounded-full opacity-60", TONES[tone])}
        />
      ) : null}
      <span className={cn("relative inline-flex size-2 rounded-full", TONES[tone])} />
    </span>
  );
}
