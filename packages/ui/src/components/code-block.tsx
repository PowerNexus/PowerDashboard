"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "../lib/cn";

export interface CopyButtonProps {
  value: string;
  label?: string;
  /** Libellé affiché pendant les deux secondes qui suivent la copie. */
  copiedLabel?: string;
  className?: string;
}

/** Bouton de copie avec retour visuel de deux secondes. */
export function CopyButton({
  value,
  label = "Copier",
  copiedLabel = "Copié",
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Le presse-papier peut être refusé (contexte non sécurisé) : on reste silencieux.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? copiedLabel : label}
      className={cn(
        "inline-flex size-8 cursor-pointer items-center justify-center rounded-xs text-muted transition-colors hover:bg-surface-2 hover:text-fg [&_svg]:size-4",
        copied && "text-success-ink hover:text-success-ink",
        className,
      )}
    >
      {copied ? <Check /> : <Copy />}
    </button>
  );
}

export interface CodeBlockProps {
  code: string;
  /** Intitulé affiché en en-tête (langage, nom de fichier, commande). */
  title?: string;
  /** Intitulé de repli quand aucun titre n'est fourni. */
  fallbackTitle?: string;
  className?: string;
}

/** Bloc de code monospace sur fond console, avec en-tête et bouton de copie. */
export function CodeBlock({ code, title, fallbackTitle = "Exemple", className }: CodeBlockProps) {
  return (
    <div
      className={cn("overflow-hidden rounded-card border border-border bg-console-bg", className)}
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-console-fg/60">
          {title ?? fallbackTitle}
        </span>
        <CopyButton
          value={code}
          className="text-console-fg/60 hover:bg-white/10 hover:text-console-fg"
        />
      </div>
      <pre className="gd-mono overflow-x-auto px-4 py-3 text-[13px] leading-6 text-console-fg">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

const METHOD_STYLE: Record<HttpMethod, string> = {
  GET: "bg-info-soft text-info-ink",
  POST: "bg-success-soft text-success-ink",
  PATCH: "bg-warning-soft text-warning-ink",
  PUT: "bg-warning-soft text-warning-ink",
  DELETE: "bg-danger-soft text-danger-ink",
};

/** Pastille de méthode HTTP, largeur fixe pour aligner les colonnes. */
export function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span
      className={cn(
        "gd-mono inline-flex w-16 shrink-0 items-center justify-center rounded-xs px-1.5 py-1 text-[11px] font-bold",
        METHOD_STYLE[method],
      )}
    >
      {method}
    </span>
  );
}
