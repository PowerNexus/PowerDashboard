"use client";

import { ChevronDown } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../lib/cn";
import { SidebarToggle } from "./app-shell";
import { Avatar } from "./avatar";

export interface AppHeaderProps {
  brand: ReactNode;
  /** Actions à droite (boutons, icônes, langue…). */
  actions?: ReactNode;
  /** Slot central (recherche / command palette). */
  center?: ReactNode;
  className?: string;
}

/** Header : marque + burger à gauche, slot central, rangée d'actions à droite. */
export function AppHeader({ brand, actions, center, className }: AppHeaderProps) {
  return (
    <div className={cn("flex h-full items-center gap-4 px-4 sm:px-6", className)}>
      <div className="flex items-center gap-3">
        {brand}
        <SidebarToggle />
      </div>
      <div className="hidden flex-1 justify-center md:flex">{center}</div>
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </div>
  );
}

export interface HeaderIconButtonProps {
  icon: ReactNode;
  label: string;
  count?: number;
  onClick?: () => void;
}

/** Icône de header avec badge compteur rouge (panier, notifications). */
export function HeaderIconButton({ icon, label, count, onClick }: HeaderIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="relative inline-flex size-10 cursor-pointer items-center justify-center rounded-field border border-border bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-fg [&_svg]:size-[18px]"
    >
      {icon}
      {count ? (
        <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-[18px] text-white">
          {count}
        </span>
      ) : null}
    </button>
  );
}

export interface HeaderUserProps extends ComponentPropsWithoutRef<"button"> {
  name: string;
  greeting?: string;
  avatarUrl?: string | null;
}

/**
 * Bloc « BIENVENUE / Matheo » avec avatar initiale et chevron.
 *
 * **Le reste des propriétés est transmis au bouton, et c'est ce qui le rend
 * utilisable comme déclencheur de menu.** Radix, en `asChild`, ne rend aucun
 * élément à lui : il confie à l'enfant un `ref`, un `onClick`, un `aria-expanded`
 * et un `data-state`. Un composant qui ne retient que les propriétés qu'il
 * connaît les jette toutes — le menu ne s'ouvrait donc pas, et le chevron ne
 * tournait pas, faute de recevoir l'état qui le fait tourner.
 */
export function HeaderUser({
  name,
  greeting = "Bienvenue",
  avatarUrl,
  className,
  ...rest
}: HeaderUserProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "group flex h-10 cursor-pointer items-center gap-2.5 rounded-field border border-border bg-surface pl-1.5 pr-2.5 transition-colors hover:bg-surface-2 data-[state=open]:border-accent data-[state=open]:bg-surface-2",
        className,
      )}
    >
      <Avatar name={name} src={avatarUrl} size="sm" />
      <span className="hidden flex-col leading-none sm:flex">
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted">
          {greeting}
        </span>
        <span className="mt-0.5 text-sm font-semibold text-fg">{name}</span>
      </span>
      <ChevronDown className="size-4 text-faint transition-transform group-data-[state=open]:rotate-180" />
    </button>
  );
}

/**
 * En-tête du menu de compte : qui est connecté, en toutes lettres.
 *
 * Le nom seul ne suffit pas quand on tient plusieurs comptes — client, revendeur,
 * administration : l'adresse e-mail est ce qui les distingue, et c'est la
 * première chose qu'on vient vérifier en ouvrant ce menu.
 */
export function HeaderUserIdentity({
  name,
  email,
  avatarUrl,
  role,
  method,
}: {
  name: string;
  email: string;
  avatarUrl?: string | null;
  /** Rôle déjà traduit — « Administrateur », « Revendeur »… */
  role?: string;
  /**
   * Comment cette session a été ouverte, déjà mise en phrase.
   *
   * Dite parce qu'elle change ce qu'on peut faire : quelqu'un entré par un
   * compte externe n'a pas forcément de mot de passe à changer, et le chercher
   * dans les réglages de sécurité ne mène à rien.
   */
  method?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-2.5 py-3">
      <Avatar name={name} src={avatarUrl} size="lg" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold text-fg text-sm">{name}</span>
          {role ? (
            <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-[10px] text-accent uppercase tracking-wide">
              {role}
            </span>
          ) : null}
        </span>
        <span className="truncate text-muted text-xs">{email}</span>
        {method ? <span className="truncate text-faint text-[11px]">{method}</span> : null}
      </span>
    </div>
  );
}

export interface HeaderStatProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
}

/** Petit bloc « CRÉDIT / 0.00 EUR » : label capitales + valeur. */
export function HeaderStat({ label, value, icon }: HeaderStatProps) {
  return (
    <div className="hidden h-10 items-center gap-2.5 rounded-field border border-border bg-surface px-3 md:flex">
      {icon ? <span className="text-muted [&_svg]:size-4">{icon}</span> : null}
      <span className="flex flex-col leading-none">
        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted">{label}</span>
        <span className="mt-0.5 text-sm font-semibold text-fg">{value}</span>
      </span>
    </div>
  );
}
