"use client";

import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  options: SelectOption[];
  invalid?: boolean;
  selectSize?: "md" | "lg";
}

/** Select natif stylé : accessible par défaut, correct sur mobile. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, invalid, selectSize = "md", ...props }, ref) => (
    <div
      className={cn(
        "relative flex items-center rounded-field border bg-surface-2 transition-shadow focus-within:border-accent focus-within:shadow-[var(--gd-ring)]",
        selectSize === "lg" ? "h-11" : "h-10",
        invalid ? "border-danger" : "border-border",
        className,
      )}
    >
      <select
        ref={ref}
        className="w-full cursor-pointer appearance-none bg-transparent px-3 pr-9 text-sm text-fg outline-none focus:shadow-none"
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-4 text-faint" />
    </div>
  ),
);
Select.displayName = "Select";
