import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center px-6 py-16 text-center", className)}
    >
      {icon ? (
        <span className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent [&_svg]:size-7">
          {icon}
        </span>
      ) : null}
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
