"use client";

import { Menu, X } from "lucide-react";
import { createContext, type ReactNode, useContext, useState } from "react";
import { cn } from "../lib/cn";
import { NavigationProgressBar, NavigationProgressProvider } from "./navigation-progress";

interface ShellCtx {
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}
const Ctx = createContext<ShellCtx>({ mobileOpen: false, setMobileOpen: () => {} });

export interface AppShellProps {
  header: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
  /** Libellés accessibles du tiroir mobile, pour les applications traduites. */
  closeMenuLabel?: string;
  closeLabel?: string;
  className?: string;
}

/**
 * Coquille applicative : header fixe en haut, sidebar à gauche (drawer sur mobile),
 * contenu scrollable. Toutes les pages authentifiées passent par ici.
 */
export function AppShell({
  header,
  sidebar,
  children,
  closeMenuLabel = "Fermer le menu",
  closeLabel = "Fermer",
  className,
}: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <NavigationProgressProvider>
      <Ctx.Provider value={{ mobileOpen, setMobileOpen }}>
        <div className={cn("flex min-h-dvh flex-col bg-bg", className)}>
          {/* `relative` : la barre de navigation se pose sur la bordure basse du
            header, qui est son repère de position. */}
          <header className="sticky top-0 z-40 h-[var(--gd-header-h)] border-b border-border bg-surface relative">
            {header}
            <NavigationProgressBar />
          </header>
          <div className="flex flex-1">
            {/* Sidebar desktop */}
            {/* Même règle qu'au tiroir : le cadre tient la hauteur, la
                navigation défile, le bloc du bas reste en place. */}
            <aside className="sticky top-[var(--gd-header-h)] hidden h-[calc(100dvh-var(--gd-header-h))] w-[var(--gd-sidebar-w)] shrink-0 overflow-hidden border-r border-border bg-surface lg:flex lg:flex-col">
              {sidebar}
            </aside>
            {/* Drawer mobile */}
            {mobileOpen ? (
              <div className="fixed inset-0 z-50 lg:hidden">
                <button
                  type="button"
                  aria-label={closeMenuLabel}
                  className="absolute inset-0 bg-black/50"
                  onClick={() => setMobileOpen(false)}
                />
                {/*
                  `overflow-hidden` et non `overflow-y-auto` : c'est la
                  navigation, à l'intérieur, qui défile. Deux conteneurs
                  défilants imbriqués donnent deux barres, et celle du
                  parent emporte le bloc du bas hors de l'écran.
                */}
                <aside className="absolute inset-y-0 left-0 flex w-[min(85vw,var(--gd-sidebar-w))] flex-col overflow-hidden bg-surface shadow-lg">
                  <div className="flex h-[var(--gd-header-h)] items-center justify-end px-4">
                    <button
                      type="button"
                      onClick={() => setMobileOpen(false)}
                      className="cursor-pointer text-muted hover:text-fg"
                      aria-label={closeLabel}
                    >
                      <X className="size-5" />
                    </button>
                  </div>
                  {sidebar}
                </aside>
              </div>
            ) : null}
            <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
          </div>
        </div>
      </Ctx.Provider>
    </NavigationProgressProvider>
  );
}

/** Bouton burger à placer dans le header. */
export function SidebarToggle({
  label = "Ouvrir le menu",
  className,
}: {
  /** Libellé accessible du bouton, pour les applications traduites. */
  label?: string;
  className?: string;
}) {
  const { setMobileOpen } = useContext(Ctx);
  return (
    <button
      type="button"
      onClick={() => setMobileOpen(true)}
      className={cn(
        "inline-flex size-9 cursor-pointer items-center justify-center rounded-field text-muted hover:bg-surface-2 hover:text-fg lg:hidden",
        className,
      )}
      aria-label={label}
    >
      <Menu className="size-5" />
    </button>
  );
}
