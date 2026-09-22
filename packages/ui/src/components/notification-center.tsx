"use client";

import * as Popover from "@radix-ui/react-popover";
import { Bell, CheckCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { EmptyState } from "./empty-state";
import { RelativeTime } from "./relative-time";

export type NotificationLevel = "info" | "success" | "warning" | "danger";

export interface NotificationItem {
  id: string;
  title: string;
  body?: string;
  level: NotificationLevel;
  createdAt: string;
  readAt: string | null;
  /** Contexte : nom du serveur ou du node concerné. */
  source?: string;
  /**
   * Où mène la notification, quand elle mène quelque part.
   *
   * Absente, la ligne reste lisible mais n'invite pas au clic : une cloche qui
   * paraît cliquable et ne fait rien est plus déroutante qu'une cloche qui
   * informe.
   */
  href?: string | null;
}

const LEVEL_DOT: Record<NotificationLevel, string> = {
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export interface NotificationCenterProps {
  notifications: NotificationItem[];
  onMarkAllRead?: () => void;
  onSelect?: (item: NotificationItem) => void;
  emptyState?: ReactNode;
  /** Libellés, pour les applications traduites. */
  title?: string;
  unreadLabel?: (unread: number) => string;
  markAllReadLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}

/** Cloche du header + panneau déroulant des notifications persistantes. */
export function NotificationCenter({
  notifications,
  onMarkAllRead,
  onSelect,
  emptyState,
  title = "Notifications",
  unreadLabel = (n: number) => `Notifications (${n} non lues)`,
  markAllReadLabel = "Tout marquer comme lu",
  emptyTitle = "Rien de neuf",
  emptyDescription = "Les événements de vos serveurs apparaîtront ici.",
}: NotificationCenterProps) {
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={unread ? unreadLabel(unread) : title}
          className="relative inline-flex size-10 cursor-pointer items-center justify-center rounded-field border border-border bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-fg data-[state=open]:bg-surface-2 data-[state=open]:text-fg"
        >
          <Bell className="size-[18px]" />
          {unread > 0 ? (
            <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-[18px] text-white">
              {unread}
            </span>
          ) : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[min(92vw,380px)] overflow-hidden rounded-card border border-border bg-surface shadow-lg"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <p className="text-sm font-semibold text-fg">{title}</p>
            {notifications.length > 0 && unread > 0 ? (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-accent hover:underline"
              >
                <CheckCheck className="size-3.5" />
                {markAllReadLabel}
              </button>
            ) : null}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {notifications.length === 0 ? (
              (emptyState ?? (
                <EmptyState
                  icon={<Bell />}
                  title={emptyTitle}
                  description={emptyDescription}
                  className="py-10"
                />
              ))
            ) : (
              <ul>
                {notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onSelect?.(n)}
                      disabled={!n.href}
                      className={cn(
                        "flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-0",
                        n.href ? "cursor-pointer hover:bg-surface-2" : "cursor-default",
                        !n.readAt && "bg-accent-soft/40",
                      )}
                    >
                      <span
                        className={cn("mt-1.5 size-2 shrink-0 rounded-full", LEVEL_DOT[n.level])}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn("truncate text-sm text-fg", !n.readAt && "font-semibold")}
                          >
                            {n.title}
                          </span>
                          <RelativeTime
                            className="shrink-0 text-[11px] text-faint"
                            value={n.createdAt}
                          />
                        </span>
                        {n.body ? (
                          <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                            {n.body}
                          </span>
                        ) : null}
                        {n.source ? (
                          <span className="mt-1 block truncate text-[11px] text-faint">
                            {n.source}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
