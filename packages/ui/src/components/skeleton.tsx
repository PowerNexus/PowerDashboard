import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-xs bg-surface-3", className)} {...props} />;
}
