"use client";

import { useId, useState } from "react";
import { cn } from "../lib/cn";

export interface Point {
  t: number;
  v: number;
}

export interface SparkChartProps {
  title: string;
  subtitle?: string;
  data: Point[];
  max?: number;
  unit?: string;
  ranges?: string[];
  range?: string;
  onRangeChange?: (r: string) => void;
  format?: (v: number) => string;
  height?: number;
  className?: string;
}

/**
 * Graphe de zone léger en SVG (aucune dépendance) pour CPU / mémoire, avec sélecteur de plage
 * en pilules (1m / 5m). Remplaçable par uPlot sans changer les props.
 */
export function SparkChart({
  title,
  subtitle,
  data,
  max,
  unit = "",
  ranges = ["1m", "5m"],
  range,
  onRangeChange,
  format = (v) => v.toFixed(2),
  height = 140,
  className,
}: SparkChartProps) {
  const [inner, setInner] = useState(ranges[0] ?? "");
  const current = range ?? inner;
  const gid = useId();
  const W = 600;
  const H = height;
  const m = max ?? Math.max(1, ...data.map((d) => d.v));
  const n = data.length;
  const pts = data.map(
    (d, i) => [n > 1 ? (i / (n - 1)) * W : 0, H - (Math.min(d.v, m) / m) * (H - 8) - 4] as const,
  );
  const path = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = pts.length ? `${path} L${W},${H} L0,${H} Z` : "";
  const last = data[n - 1]?.v ?? 0;

  return (
    <div className={cn("rounded-card border border-border bg-surface p-5 shadow-card", className)}>
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          <p className="text-xs text-muted">{subtitle ?? `${format(last)}${unit}`}</p>
        </div>
        <div className="flex gap-1 rounded-field bg-surface-2 p-0.5">
          {ranges.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setInner(r);
                onRangeChange?.(r);
              }}
              className={cn(
                "cursor-pointer rounded-xs px-2.5 py-1 text-[11px] font-semibold",
                current === r ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg",
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={title}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--gd-accent-500)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--gd-accent-500)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={W} y1={4} y2={4} stroke="var(--gd-border)" strokeDasharray="4 4" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--gd-border)" strokeDasharray="4 4" />
        {area ? <path d={area} fill={`url(#${gid})`} /> : null}
        {path ? (
          <path
            d={path}
            fill="none"
            stroke="var(--gd-accent-500)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-faint">
        <span>0{unit}</span>
        <span>
          {format(m)}
          {unit}
        </span>
      </div>
    </div>
  );
}
