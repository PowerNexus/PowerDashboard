"use client";

import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";

export interface WizardStep {
  id: string;
  title: string;
  description?: string;
  content: ReactNode;
  /** Bloque le passage à l'étape suivante tant que c'est faux. */
  isComplete?: boolean;
}

export interface WizardProps {
  steps: WizardStep[];
  /** Panneau latéral persistant (récapitulatif de la commande). */
  aside?: ReactNode;
  onFinish?: () => void;
  finishLabel?: string;
  className?: string;
}

/**
 * Assistant multi-étapes : rail de progression numéroté, contenu de l'étape,
 * navigation. Les étapes déjà validées sont cliquables pour revenir en arrière.
 */
export function Wizard({
  steps,
  aside,
  onFinish,
  finishLabel = "Terminer",
  className,
}: WizardProps) {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const isLast = index === steps.length - 1;
  const canAdvance = step?.isComplete !== false;

  if (!step) return null;

  return (
    <div className={cn("grid gap-6 lg:grid-cols-[1fr_320px]", className)}>
      <div className="flex flex-col gap-6">
        <ol className="flex flex-wrap gap-x-2 gap-y-3">
          {steps.map((s, i) => {
            const done = i < index;
            const current = i === index;
            return (
              <li key={s.id} className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={i > index}
                  onClick={() => setIndex(i)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-field px-3 py-2 text-sm font-semibold transition-colors",
                    i <= index ? "cursor-pointer" : "cursor-not-allowed",
                    current && "bg-accent-soft text-accent",
                    done && "text-fg hover:bg-surface-2",
                    !current && !done && "text-faint",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      current && "bg-accent text-accent-fg",
                      done && "bg-success text-white",
                      !current && !done && "border border-border text-faint",
                    )}
                  >
                    {done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="hidden sm:inline">{s.title}</span>
                </button>
                {i < steps.length - 1 ? (
                  <span className="hidden h-px w-6 bg-border sm:block" aria-hidden />
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="rounded-card border border-border bg-surface shadow-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-base font-semibold text-fg">{step.title}</h2>
            {step.description ? (
              <p className="mt-0.5 text-sm text-muted">{step.description}</p>
            ) : null}
          </div>
          <div className="px-6 py-5">{step.content}</div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <Button
            variant="secondary"
            disabled={index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
          >
            <ChevronLeft /> Précédent
          </Button>
          {isLast ? (
            <Button disabled={!canAdvance} onClick={onFinish}>
              {finishLabel} <ChevronRight />
            </Button>
          ) : (
            <Button
              disabled={!canAdvance}
              onClick={() => setIndex((i) => Math.min(steps.length - 1, i + 1))}
            >
              Suivant <ChevronRight />
            </Button>
          )}
        </div>
      </div>

      {aside ? <div className="lg:sticky lg:top-24 lg:self-start">{aside}</div> : null}
    </div>
  );
}

export interface OptionCardProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** Carte sélectionnable, utilisée pour choisir un jeu, un plan ou une localisation. */
export function OptionCard({
  title,
  description,
  icon,
  meta,
  selected,
  disabled,
  onSelect,
}: OptionCardProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-start gap-3 rounded-card border p-4 text-left transition-colors",
        disabled
          ? "cursor-not-allowed border-border opacity-50"
          : "cursor-pointer hover:border-border-strong",
        selected ? "border-accent bg-accent-soft/40" : "border-border bg-surface",
      )}
    >
      {icon ? (
        <span
          className={cn(
            "inline-flex size-10 shrink-0 items-center justify-center rounded-field [&_svg]:size-5",
            selected ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold text-fg">{title}</span>
          {meta ? <span className="shrink-0 text-sm text-muted">{meta}</span> : null}
        </span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted">{description}</span>
        ) : null}
      </span>
      <span
        className={cn(
          "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          selected ? "border-accent bg-accent text-white" : "border-border-strong",
        )}
        aria-hidden
      >
        {selected ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}
