"use client";

import { Check } from "lucide-react";
import { cn } from "../lib/cn";

export interface PermissionEntry {
  value: string;
  label: string;
  description?: string;
  /**
   * Conséquence que l'intitulé seul ne laisse pas deviner.
   *
   * Rendue distinctement d'une description : « Supprimer » et « aucune
   * corbeille, les mondes partent avec » ne se lisent pas de la même façon, et
   * une mise en garde grise au milieu d'explications grises ne se lit pas du
   * tout.
   */
  warning?: string;
}

export interface PermissionGroup {
  key: string;
  label: string;
  description?: string;
  permissions: readonly PermissionEntry[];
}

export interface PermissionMatrixProps {
  groups: readonly PermissionGroup[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Libellés de la bascule de groupe, pour les applications traduites. */
  checkAllLabel?: string;
  uncheckAllLabel?: string;
}

/**
 * Matrice de permissions par groupe, avec case « tout le groupe ».
 * Utilisée pour les sous-utilisateurs et les scopes de clé API.
 */
export function PermissionMatrix({
  groups,
  value,
  onChange,
  disabled,
  checkAllLabel = "Tout cocher",
  uncheckAllLabel = "Tout retirer",
}: PermissionMatrixProps) {
  const toggle = (perm: string) =>
    onChange(value.includes(perm) ? value.filter((p) => p !== perm) : [...value, perm]);

  const toggleGroup = (group: PermissionGroup) => {
    const all = group.permissions.map((p) => p.value);
    const complete = all.every((p) => value.includes(p));
    onChange(complete ? value.filter((p) => !all.includes(p)) : [...new Set([...value, ...all])]);
  };

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const all = group.permissions.map((p) => p.value);
        const selected = all.filter((p) => value.includes(p)).length;
        const complete = selected === all.length;
        return (
          <div key={group.key} className="rounded-card border border-border bg-surface">
            <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-fg">{group.label}</p>
                {group.description ? (
                  <p className="text-xs text-muted">{group.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggleGroup(group)}
                className="cursor-pointer whitespace-nowrap text-xs font-semibold text-accent hover:underline disabled:opacity-50"
              >
                {complete ? uncheckAllLabel : checkAllLabel}
                <span className="ml-1.5 text-muted">
                  ({selected}/{all.length})
                </span>
              </button>
            </div>
            <div className="grid gap-x-6 gap-y-1 p-3 sm:grid-cols-2">
              {group.permissions.map((perm) => {
                const on = value.includes(perm.value);
                return (
                  <label
                    key={perm.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-xs px-2 py-1.5 transition-colors hover:bg-surface-2",
                      disabled && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      disabled={disabled}
                      onChange={() => toggle(perm.value)}
                    />
                    <span
                      className={cn(
                        "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                        on ? "border-accent bg-accent text-white" : "border-border-strong",
                      )}
                    >
                      {on ? <Check className="size-3" strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-fg">{perm.label}</span>
                      {perm.description ? (
                        <span className="block text-xs text-muted">{perm.description}</span>
                      ) : null}
                      {perm.warning ? (
                        <span className="block text-xs text-warning-ink">{perm.warning}</span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
