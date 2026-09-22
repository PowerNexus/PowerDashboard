"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export const Dropdown = Menu.Root;
export const DropdownTrigger = Menu.Trigger;

export function DropdownContent({
  children,
  align = "end",
  className,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <Menu.Portal>
      <Menu.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-48 overflow-hidden rounded-card border border-border bg-surface p-1 shadow-lg",
          className,
        )}
      >
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}

export interface DropdownItemProps {
  children: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export function DropdownItem({
  children,
  icon,
  onSelect,
  destructive,
  disabled,
}: DropdownItemProps) {
  return (
    <Menu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-xs px-2.5 py-2 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        destructive
          ? "text-danger-ink data-[highlighted]:bg-danger-soft"
          : "text-fg data-[highlighted]:bg-surface-2",
      )}
    >
      {icon ? <span className={destructive ? "text-danger-ink" : "text-muted"}>{icon}</span> : null}
      {children}
    </Menu.Item>
  );
}

export function DropdownSeparator() {
  return <Menu.Separator className="my-1 h-px bg-border" />;
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return (
    <Menu.Label className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
      {children}
    </Menu.Label>
  );
}

/** Bouton « … » standard pour les actions de ligne dans une DataTable. */
export function RowActions({
  children,
  label = "Actions",
}: {
  children: ReactNode;
  /** Libellé accessible du déclencheur, pour les applications traduites. */
  label?: string;
}) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-xs text-muted transition-colors hover:bg-surface-2 hover:text-fg data-[state=open]:bg-surface-2"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownTrigger>
      <DropdownContent>{children}</DropdownContent>
    </Dropdown>
  );
}
