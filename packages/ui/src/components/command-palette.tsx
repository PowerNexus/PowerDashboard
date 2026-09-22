"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { CornerDownLeft, Search } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";

export interface CommandAction {
  id: string;
  label: string;
  /** Texte secondaire affiché à droite du libellé. */
  hint?: string;
  icon?: ReactNode;
  group: string;
  /** Mots supplémentaires pris en compte par la recherche. */
  keywords?: string;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  actions: CommandAction[];
  placeholder?: string;
  /** Libellé accessible du champ, pour les applications traduites. */
  searchLabel?: string;
  /** Raccourci d'ouverture, combiné à Ctrl/Cmd. */
  shortcutKey?: string;
}

function score(action: CommandAction, query: string): boolean {
  if (!query) return true;
  const haystack = `${action.label} ${action.group} ${action.keywords ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((token) => haystack.includes(token));
}

/**
 * Palette de commandes ouverte par Ctrl+K / Cmd+K : navigation et actions rapides.
 * Les actions sont déclaratives, la palette ne connaît aucune logique métier.
 */
export function CommandPalette({
  actions,
  placeholder = "Rechercher une page, un serveur, une action…",
  searchLabel = "Rechercher",
  shortcutKey = "k",
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === shortcutKey) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutKey]);

  const results = useMemo(() => actions.filter((a) => score(a, query)), [actions, query]);

  const groups = useMemo(() => {
    const map = new Map<string, CommandAction[]>();
    for (const action of results) {
      const list = map.get(action.group) ?? [];
      list.push(action);
      map.set(action.group, list);
    }
    return [...map.entries()];
  }, [results]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: recentrer la sélection à chaque recherche
  useEffect(() => setActive(0), [query, open]);

  const run = (action: CommandAction | undefined) => {
    if (!action) return;
    setOpen(false);
    setQuery("");
    action.onSelect();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-card border border-border bg-surface shadow-lg"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(results[active]);
            }
          }}
        >
          <DialogPrimitive.Title className="sr-only">Palette de commandes</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Recherchez une page ou une action, puis validez avec Entrée.
          </DialogPrimitive.Description>

          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-faint" />
            {/* Radix place le focus sur le premier élément focusable à l'ouverture. */}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              aria-label={searchLabel}
              className="h-12 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-faint focus:shadow-none"
            />
            <kbd className="rounded-xs border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted">
              ESC
            </kbd>
          </div>

          <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
            {results.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted">Aucun résultat.</p>
            ) : (
              groups.map(([group, items]) => (
                <div key={group} className="mb-1">
                  <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {group}
                  </p>
                  {items.map((action) => {
                    const index = results.indexOf(action);
                    const isActive = index === active;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        onMouseMove={() => setActive(index)}
                        onClick={() => run(action)}
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-3 rounded-xs px-3 py-2.5 text-left text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
                          isActive ? "bg-accent-soft text-accent" : "text-fg",
                        )}
                      >
                        <span className={isActive ? "text-accent" : "text-muted"}>
                          {action.icon}
                        </span>
                        <span className="flex-1 truncate">{action.label}</span>
                        {action.hint ? (
                          <span className="gd-mono truncate text-xs text-faint">{action.hint}</span>
                        ) : null}
                        {isActive ? <CornerDownLeft className="text-accent" /> : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Bouton de header qui ouvre la palette (affiche le raccourci). */
export function CommandPaletteTrigger({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden h-10 w-full max-w-sm cursor-pointer items-center gap-2.5 rounded-field border border-border bg-surface-2 px-3 text-sm text-muted transition-colors hover:bg-surface-3 md:flex"
    >
      <Search className="size-4" />
      <span className="flex-1 text-left">Rechercher…</span>
      <kbd className="rounded-xs border border-border bg-surface px-1.5 py-0.5 text-[10px] font-semibold">
        Ctrl K
      </kbd>
    </button>
  );
}
