"use client";

import { cn } from "@gamedashboard/ui";
import type { TextareaHTMLAttributes } from "react";

/**
 * Zone de texte aux couleurs des champs du panel.
 *
 * Le design system n'en a pas encore ; celle-ci reprend les classes de
 * `Input` (bordure, fond, halo au focus) pour qu'un formulaire qui mêle les
 * deux ne change pas de style d'un champ à l'autre.
 */
export function EggTextArea({
  className,
  invalid,
  mono,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; mono?: boolean }) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || undefined}
      spellCheck={mono ? false : props.spellCheck}
      className={cn(
        "w-full rounded-field border bg-surface-2 p-3 text-fg text-sm outline-none placeholder:text-faint focus:border-accent focus:shadow-[var(--gd-ring)]",
        invalid ? "border-danger" : "border-border",
        mono && "gd-mono text-xs",
        className,
      )}
    />
  );
}

/** Un exemple de saisie, sous un champ : c'est souvent plus clair qu'une phrase. */
export function EggExample({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-faint text-xs">
      {label}{" "}
      <code className="gd-mono rounded-sm bg-surface-2 px-1 py-0.5 text-muted">{value}</code>
    </p>
  );
}
