import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold leading-5",
  {
    variants: {
      variant: {
        neutral: "bg-surface-2 text-muted",
        accent: "bg-accent-soft text-accent",
        solid: "bg-accent text-accent-fg uppercase tracking-wide text-[10px]",
        success: "bg-success-soft text-success-ink",
        warning: "bg-warning-soft text-warning-ink",
        danger: "bg-danger-soft text-danger-ink",
        info: "bg-info-soft text-info-ink",
        outline: "border border-border text-muted",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
