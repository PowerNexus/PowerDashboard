import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-card border border-border bg-surface shadow-card", className)}
      {...props}
    />
  );
}

// `title` est omis des attributs HTML natifs : ici c'est un ReactNode, pas une infobulle.
export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  step?: number;
  actions?: ReactNode;
  icon?: ReactNode;
}

/** En-tête de carte avec numéro d'étape optionnel (« 2 Informations client »). */
export function CardHeader({
  title,
  description,
  step,
  actions,
  icon,
  className,
  ...props
}: CardHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-border px-6 py-4",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-3">
        {step !== undefined ? (
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">
            {step}
          </span>
        ) : null}
        {icon ? <span className="text-accent [&_svg]:size-5">{icon}</span> : null}
        <div>
          <h3 className="text-base font-semibold text-fg">{title}</h3>
          {description ? <p className="text-sm text-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 py-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 border-t border-border px-6 py-4",
        className,
      )}
      {...props}
    />
  );
}

export interface KeyValueGridProps {
  items: { label: ReactNode; value: ReactNode }[];
  columns?: 1 | 2;
  className?: string;
}

/** Grille label/valeur à deux colonnes (cf. « Informations client »). */
export function KeyValueGrid({ items, columns = 2, className }: KeyValueGridProps) {
  return (
    <dl className={cn("grid gap-x-8", columns === 2 ? "sm:grid-cols-2" : "grid-cols-1", className)}>
      {items.map((item, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: liste statique
          key={i}
          className="flex items-center justify-between gap-4 border-b border-border py-3 text-sm last:border-0 sm:[&:nth-last-child(2)]:border-0"
        >
          <dt className="text-muted">{item.label}</dt>
          <dd className="text-right font-medium text-fg">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
