"use client";

import { createContext, type ReactNode, useContext, useId, useState } from "react";
import { cn } from "../lib/cn";

interface TabsCtx {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
}
const Ctx = createContext<TabsCtx | null>(null);

export interface TabsProps {
  value?: string;
  defaultValue: string;
  onValueChange?: (v: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ value, defaultValue, onValueChange, children, className }: TabsProps) {
  const [inner, setInner] = useState(defaultValue);
  const baseId = useId();
  const current = value ?? inner;
  const setValue = (v: string) => {
    setInner(v);
    onValueChange?.(v);
  };
  return (
    <Ctx.Provider value={{ value: current, setValue, baseId }}>
      <div className={className}>{children}</div>
    </Ctx.Provider>
  );
}

export type TabsListVariant = "underline" | "pill";

export function TabsList({
  children,
  variant = "underline",
  className,
}: {
  children: ReactNode;
  variant?: TabsListVariant;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      data-variant={variant}
      className={cn(
        "flex items-center gap-1",
        variant === "underline" && "border-b border-border",
        variant === "pill" && "rounded-field bg-surface-2 p-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  count?: number;
  className?: string;
}

/** Onglet avec compteur en pilule (« En cours 2 »). */
export function TabsTrigger({ value, children, count, className }: TabsTriggerProps) {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("TabsTrigger doit être dans <Tabs>");
  const active = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${ctx.baseId}-tab-${value}`}
      aria-selected={active}
      aria-controls={`${ctx.baseId}-panel-${value}`}
      onClick={() => ctx.setValue(value)}
      className={cn(
        "group inline-flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-colors",
        // underline
        "[[data-variant=underline]_&]:-mb-px [[data-variant=underline]_&]:border-b-2 [[data-variant=underline]_&]:border-transparent [[data-variant=underline]_&]:text-muted [[data-variant=underline]_&]:hover:text-fg",
        active &&
          "[[data-variant=underline]_&]:border-accent [[data-variant=underline]_&]:text-accent",
        // pill
        "[[data-variant=pill]_&]:rounded-xs [[data-variant=pill]_&]:px-3 [[data-variant=pill]_&]:py-1.5 [[data-variant=pill]_&]:text-muted",
        active &&
          "[[data-variant=pill]_&]:bg-surface [[data-variant=pill]_&]:text-fg [[data-variant=pill]_&]:shadow-card",
        className,
      )}
    >
      {children}
      {count !== undefined ? (
        <span
          className={cn(
            "inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-5",
            active ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("TabsContent doit être dans <Tabs>");
  if (ctx.value !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-panel-${value}`}
      aria-labelledby={`${ctx.baseId}-tab-${value}`}
      className={className}
    >
      {children}
    </div>
  );
}
