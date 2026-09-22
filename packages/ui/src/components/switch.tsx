"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import { forwardRef, type ReactNode, useId } from "react";
import { cn } from "../lib/cn";

export const Switch = forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-accent data-[state=unchecked]:bg-surface-3",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full bg-white shadow-card ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";

export interface SettingToggleProps {
  /** `ReactNode` et non `string` : un réglage porte parfois un état à côté de son nom. */
  label: ReactNode;
  description?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}

/** Ligne de réglage : libellé + description à gauche, interrupteur à droite. */
export function SettingToggle({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: SettingToggleProps) {
  // Radix rend un <button>, pas un <input> : l'association passe par htmlFor/id.
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-semibold text-fg">{label}</span>
        {description ? <span className="block text-xs text-muted">{description}</span> : null}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}
