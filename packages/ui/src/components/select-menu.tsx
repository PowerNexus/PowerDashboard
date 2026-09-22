"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface SelectMenuOption {
  value: string;
  label: string;
  /** Texte secondaire affiché sous le libellé. */
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Regroupe les options sous un intitulé. */
  group?: string;
}

export interface SelectMenuProps {
  options: SelectMenuOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  size?: "md" | "lg";
  id?: string;
  "aria-label"?: string;
  className?: string;
  /** Largeur du menu : par défaut celle du déclencheur. */
  matchTriggerWidth?: boolean;
}

/**
 * Menu déroulant stylé, entièrement soumis aux tokens du design system.
 * Remplace le `<select>` natif, dont la liste est rendue par le système
 * et ignore donc le thème sombre.
 */
export function SelectMenu({
  options,
  value,
  defaultValue,
  onValueChange,
  placeholder = "Sélectionner…",
  disabled,
  invalid,
  size = "md",
  id,
  className,
  matchTriggerWidth = true,
  ...aria
}: SelectMenuProps) {
  // Préserve l'ordre de déclaration des groupes.
  const groups: [string | undefined, SelectMenuOption[]][] = [];
  for (const option of options) {
    const last = groups.at(-1);
    if (last && last[0] === option.group) last[1].push(option);
    else groups.push([option.group, [option]]);
  }

  return (
    <SelectPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={aria["aria-label"]}
        aria-invalid={invalid || undefined}
        className={cn(
          "group flex cursor-pointer items-center gap-2 rounded-field border bg-surface-2 px-3 text-left text-sm text-fg transition-shadow outline-none",
          "focus-visible:border-accent focus-visible:shadow-[var(--gd-ring)] data-[state=open]:border-accent",
          "disabled:cursor-not-allowed disabled:opacity-60",
          size === "lg" ? "h-11" : "h-10",
          invalid ? "border-danger" : "border-border",
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          <SelectPrimitive.Value placeholder={<span className="text-faint">{placeholder}</span>} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 shrink-0 text-faint transition-transform group-data-[state=open]:rotate-180" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className={cn(
            "z-50 overflow-hidden rounded-card border border-border bg-surface shadow-lg",
            matchTriggerWidth && "w-[var(--radix-select-trigger-width)]",
            "max-h-[var(--radix-select-content-available-height)]",
          )}
        >
          <SelectPrimitive.ScrollUpButton className="flex h-6 items-center justify-center text-muted">
            <ChevronUp className="size-4" />
          </SelectPrimitive.ScrollUpButton>

          <SelectPrimitive.Viewport className="p-1">
            {groups.map(([group, items], index) => (
              <SelectPrimitive.Group key={group ?? `g${index}`}>
                {group ? (
                  <SelectPrimitive.Label className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {group}
                  </SelectPrimitive.Label>
                ) : null}
                {items.map((option) => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className={cn(
                      "relative flex cursor-pointer select-none items-center gap-2.5 rounded-xs py-2 pl-2.5 pr-8 text-sm text-fg outline-none transition-colors",
                      "data-[highlighted]:bg-accent-soft data-[highlighted]:text-accent",
                      "data-[state=checked]:font-semibold",
                      "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                      "[&_svg]:size-4 [&_svg]:shrink-0",
                    )}
                  >
                    {option.icon ? <span className="text-muted">{option.icon}</span> : null}
                    <span className="min-w-0 flex-1">
                      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                      {option.description ? (
                        <span className="block truncate text-xs font-normal text-muted">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                    <SelectPrimitive.ItemIndicator className="absolute right-2.5">
                      <Check className="size-4 text-accent" strokeWidth={3} />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Group>
            ))}
          </SelectPrimitive.Viewport>

          <SelectPrimitive.ScrollDownButton className="flex h-6 items-center justify-center text-muted">
            <ChevronDown className="size-4" />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
