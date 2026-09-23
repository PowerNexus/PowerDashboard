"use client";

import { useId, useState } from "react";
import { cn } from "../lib/cn";

export interface Point {
  t: number;
  /**
   * `null` : pas de mesure à cet instant. La courbe s'interrompt et reprend au
   * point suivant — relier les deux bords dessinerait une charge que personne
   * n'a mesurée, et zéro dessinerait un serveur au repos (ADR 0005).
   */
  v: number | null;
}

export interface SparkChartProps {
  title: string;
  subtitle?: string;
  data: Point[];
  /**
   * Seconde courbe, en pointillés, sur les mêmes instants. Typiquement le
   * maximum de chaque pas quand `data` en porte la moyenne : une moyenne seule
   * lisse les pics, et ce sont eux qu'on vient chercher dans un historique.
   * Elle suit les mêmes trous que `data`.
   */
  peak?: Point[];
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
 *
 * Les points sont espacés régulièrement : c'est à l'appelant de fournir un point par pas,
 * trous compris. `ranges` vide masque le sélecteur, quand la plage se choisit ailleurs pour
 * plusieurs graphes à la fois.
 */
export function SparkChart({
  title,
  subtitle,
  data,
  peak,
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
  const valeurs = [...data, ...(peak ?? [])].flatMap((d) => (d.v === null ? [] : [d.v]));
  const m = max ?? Math.max(1, ...valeurs);
  const n = data.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0);
  const y = (v: number) => H - (Math.min(v, m) / m) * (H - 8) - 4;
  const traits = segments(data, x, y, H);
  const pics = peak ? segments(peak, x, y, H) : [];
  const last = data.findLast((d) => d.v !== null)?.v ?? null;

  return (
    <div className={cn("rounded-card border border-border bg-surface p-5 shadow-card", className)}>
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          <p className="text-xs text-muted">
            {subtitle ?? (last === null ? "—" : `${format(last)}${unit}`)}
          </p>
        </div>
        {ranges.length === 0 ? null : (
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
        )}
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
        {traits.map((trait) => (
          <g key={trait.path}>
            <path d={trait.area} fill={`url(#${gid})`} />
            <path
              d={trait.path}
              fill="none"
              stroke="var(--gd-accent-500)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
        {pics.map((trait) => (
          <path
            key={trait.path}
            d={trait.path}
            fill="none"
            stroke="var(--gd-accent-400)"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
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

/**
 * Découpe une série en tronçons continus, séparés par ses trous.
 *
 * Un point isolé entre deux trous est rendu comme un trait très court plutôt
 * qu'omis : un relevé unique reste un relevé, et le faire disparaître
 * transformerait une mesure en absence.
 */
export function segments(
  data: Point[],
  x: (i: number) => number,
  y: (v: number) => number,
  bas: number,
): { path: string; area: string }[] {
  const out: { path: string; area: string }[] = [];
  let courant: (readonly [number, number])[] = [];

  const clore = () => {
    const premier = courant[0];
    if (premier) {
      const pts = courant.length === 1 ? [premier, [premier[0] + 2, premier[1]] as const] : courant;
      const path = pts
        .map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`)
        .join(" ");
      const fin = (pts.at(-1) ?? premier)[0];
      out.push({
        path,
        area: `${path} L${fin.toFixed(1)},${bas} L${premier[0].toFixed(1)},${bas} Z`,
      });
    }
    courant = [];
  };

  data.forEach((d, i) => {
    if (d.v === null) clore();
    else courant.push([x(i), y(d.v)] as const);
  });
  clore();
  return out;
}
