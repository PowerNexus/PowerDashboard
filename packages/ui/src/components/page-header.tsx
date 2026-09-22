import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface Crumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
  /** Composant lien à injecter (next/link) pour rester agnostique du framework. */
  LinkComponent?: React.ComponentType<{ href: string; className?: string; children: ReactNode }>;
  /** Libellé accessible du fil d'Ariane, pour les applications traduites. */
  breadcrumbsLabel?: string;
  className?: string;
}

/** Icône ronde + titre + sous-titre à gauche, actions et fil d'Ariane à droite (toutes les captures). */
export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  breadcrumbs,
  LinkComponent,
  breadcrumbsLabel = "Fil d'Ariane",
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="flex items-center gap-4">
        {icon ? (
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent [&_svg]:size-6">
            {icon}
          </span>
        ) : null}
        <div>
          <h1 className="text-[28px] font-semibold leading-tight text-fg">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        {breadcrumbs?.length ? (
          <nav aria-label={breadcrumbsLabel} className="flex items-center gap-1 text-sm text-muted">
            {breadcrumbs.map((c, i) => {
              const last = i === breadcrumbs.length - 1;
              const label = last ? <span className="text-fg">{c.label}</span> : c.label;
              return (
                <span key={c.label} className="flex items-center gap-1">
                  {c.href && LinkComponent && !last ? (
                    <LinkComponent href={c.href} className="hover:text-fg">
                      {c.label}
                    </LinkComponent>
                  ) : (
                    label
                  )}
                  {!last ? <ChevronRight className="size-3.5 text-faint" /> : null}
                </span>
              );
            })}
          </nav>
        ) : null}
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
