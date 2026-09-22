"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn";

export type AlertVariant = "info" | "success" | "warning" | "danger" | "accent";

const STYLES: Record<AlertVariant, { box: string; icon: ReactNode }> = {
  accent: { box: "bg-accent-soft border-accent text-fg", icon: <Info className="text-accent" /> },
  info: { box: "bg-info-soft border-info text-fg", icon: <Info className="text-info-ink" /> },
  success: {
    box: "bg-success-soft border-success text-fg",
    icon: <CheckCircle2 className="text-success-ink" />,
  },
  warning: {
    box: "bg-warning-soft border-warning text-fg",
    icon: <AlertTriangle className="text-warning-ink" />,
  },
  danger: {
    box: "bg-danger-soft border-danger text-fg",
    icon: <XCircle className="text-danger-ink" />,
  },
};

export interface AlertBannerProps {
  variant?: AlertVariant;
  title?: ReactNode;
  children: ReactNode;
  dismissible?: boolean;
  /**
   * Appelé à la fermeture, quand l'appelant doit s'en souvenir.
   *
   * Le bandeau se ferme de lui-même dans tous les cas : ce rappel ne décide de
   * rien, il **notifie**. Le rendre obligatoire pour fermer casserait les
   * dizaines de bandeaux qui n'ont rien à retenir.
   */
  onDismiss?: () => void;
  /** Libellé du bouton de fermeture, pour les applications traduites. */
  closeLabel?: string;
  className?: string;
}

/** Bandeau à bordure gauche accent (cf. annonce « Application mobile » de la capture). */
export function AlertBanner({
  variant = "accent",
  title,
  children,
  dismissible,
  onDismiss,
  closeLabel = "Fermer",
  className,
}: AlertBannerProps) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const s = STYLES[variant];
  return (
    <div
      role="status"
      className={cn(
        "flex gap-3 rounded-card border-l-4 px-5 py-4 text-sm leading-relaxed [&_a]:font-semibold [&_a]:text-accent [&_strong]:font-semibold",
        s.box,
        className,
      )}
    >
      <span className="mt-0.5 shrink-0 [&_svg]:size-5">{s.icon}</span>
      <div className="flex-1">
        {title ? <p className="mb-1 font-semibold">{title}</p> : null}
        {children}
      </div>
      {dismissible ? (
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onDismiss?.();
          }}
          className="cursor-pointer self-start text-muted hover:text-fg"
          aria-label={closeLabel}
        >
          <X className="size-4" />
        </button>
      ) : null}
    </div>
  );
}
