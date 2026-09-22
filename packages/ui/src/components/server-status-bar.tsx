"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { cn } from "../lib/cn";
import { Badge } from "./badge";
import { MetricBar } from "./stat-tile";
import { StatusDot, type StatusTone } from "./status-dot";

export interface StatusMetric {
  label: string;
  /**
   * `null` quand la mesure n'est pas parvenue — daemon injoignable, websocket
   * pas encore ouvert. `MetricBar` la rend alors en hachures.
   *
   * Le type le permet explicitement pour éviter le réflexe du `?? 0` au point
   * d'appel : zéro se lit « rien ne consomme », ce qui est une affirmation, et
   * elle est fausse.
   */
  value: number | null;
  max: number;
  format?: (value: number) => string;
}

export interface ServerStatusBarProps {
  name: string;
  address: string;
  stateLabel: string;
  tone: StatusTone;
  pulse?: boolean;
  metrics: StatusMetric[];
  /** Contenu révélé au clic sur la barre (graphes, détails). */
  children?: ReactNode;
  defaultOpen?: boolean;
  /** Libellés de la bascule du panneau, pour les applications traduites. */
  expandLabel?: string;
  collapseLabel?: string;
  className?: string;
}

const BADGE_BY_TONE = {
  success: "success",
  danger: "danger",
  warning: "warning",
  info: "info",
  neutral: "neutral",
} as const;

/**
 * Barre d'état du serveur, toujours visible en haut des pages serveur.
 * Cliquer dessus déplie le panneau passé en `children` (graphes CPU/mémoire).
 */
export function ServerStatusBar({
  name,
  address,
  stateLabel,
  tone,
  pulse,
  metrics,
  children,
  defaultOpen = false,
  expandLabel = "Afficher les graphiques",
  collapseLabel = "Masquer les graphiques",
  className,
}: ServerStatusBarProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const collapsible = children !== undefined;

  const bar = (
    <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 text-left">
      <div className="flex items-center gap-2.5">
        <StatusDot tone={tone} pulse={pulse} />
        <span className="font-semibold text-fg">{name}</span>
        <Badge variant={BADGE_BY_TONE[tone]}>{stateLabel}</Badge>
      </div>
      <span className="gd-mono text-sm text-muted">{address}</span>
      {/*
        `min-w-0` : encore la règle des enfants de flex. Sans elle, la grille
        des mesures garde sa largeur de contenu, refuse de rétrécir, et ses
        trois colonnes se chevauchent au lieu de passer à la ligne. Le libellé
        et la valeur se retrouvaient alors l'un sur l'autre — « Processeur »
        écrit par-dessus « Inconnu / 100 % ».

        `basis-64` donne au bloc une largeur souhaitée : en dessous, la barre
        passe la grille à la ligne plutôt que de la comprimer.
      */}
      <div className="grid min-w-0 flex-1 basis-64 gap-3 sm:grid-cols-3">
        {metrics.map((m) => (
          <MetricBar key={m.label} label={m.label} value={m.value} max={m.max} format={m.format} />
        ))}
      </div>
      {collapsible ? (
        <ChevronDown
          className={cn(
            "size-5 shrink-0 text-muted transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden
        />
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        "overflow-hidden rounded-card border border-border bg-surface shadow-card",
        className,
      )}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={panelId}
          className="w-full cursor-pointer transition-colors hover:bg-surface-2/50"
        >
          {bar}
          <span className="sr-only">{open ? collapseLabel : expandLabel}</span>
        </button>
      ) : (
        bar
      )}
      {collapsible ? (
        <div id={panelId} hidden={!open} className="border-t border-border bg-bg/40 p-4">
          {children}
        </div>
      ) : null}
    </div>
  );
}
