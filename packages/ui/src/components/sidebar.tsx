"use client";

import { ChevronDown, ChevronsUpDown } from "lucide-react";
import { type ComponentType, type ReactNode, useState } from "react";
import { cn } from "../lib/cn";
import { Avatar } from "./avatar";
import { Badge } from "./badge";
import { StatusDot, type StatusTone } from "./status-dot";

export interface NavItem {
  label: string;
  href: string;
  icon?: ReactNode;
  badge?: string;
  /** Sous-items repliables (System, Management, Advanced dans la sidebar serveur). */
  children?: NavItem[];
}

export interface NavSection {
  /** Label de section en capitales (« GÉRER »). Vide = pas de label (ex. « Accès rapide »). */
  label?: string;
  items: NavItem[];
}

export type LinkLike = ComponentType<{
  href: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}>;

export interface SidebarNavProps {
  sections: NavSection[];
  currentPath: string;
  LinkComponent: LinkLike;
  /** Bloc affiché au-dessus de la nav (ex. carte du serveur courant). */
  top?: ReactNode;
  /** Bloc affiché en bas (ex. utilisateur). */
  bottom?: ReactNode;
  className?: string;
}

function matches(current: string, href: string) {
  return href === "/" ? current === "/" : current === href || current.startsWith(`${href}/`);
}

/**
 * Détermine l'entrée active : la correspondance la plus longue gagne.
 * Sans cela, « /admin » resterait surligné sur « /admin/servers », tout comme
 * « Console » sur « /server/:id/files ».
 */
function resolveActiveHref(sections: NavSection[], current: string): string | null {
  const hrefs = sections.flatMap((s) =>
    s.items.flatMap((item) => [item.href, ...(item.children?.map((c) => c.href) ?? [])]),
  );
  let best: string | null = null;
  for (const href of hrefs) {
    if (matches(current, href) && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

/** Sidebar pilotée par configuration. Une seule implémentation pour toutes les sidebars. */
export function SidebarNav({
  sections,
  currentPath,
  LinkComponent,
  top,
  bottom,
  className,
}: SidebarNavProps) {
  const activeHref = resolveActiveHref(sections, currentPath);
  return (
    /*
     * `min-h-0` sur la colonne, et le défilement **sur la navigation**.
     *
     * Sans `min-h-0`, un enfant de flex garde `min-height: auto` : il refuse
     * de rétrécir sous la hauteur de son contenu, donc `overflow-y-auto` ne
     * s'enclenche jamais et le trop-plein est **coupé** au lieu de défiler.
     * C'est ce qui tronquait le tiroir sur un écran court — la dernière entrée
     * à moitié visible, et le bloc du bas hors d'atteinte.
     *
     * Le défilement est posé ici plutôt que sur le cadre parent pour que le
     * bloc du bas — le sélecteur de serveur — reste **fixe** : c'est le seul
     * chemin pour aller ailleurs, et le faire défiler hors de l'écran le rend
     * introuvable précisément quand la liste est longue.
     */
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      {top ? <div className="px-4 pt-4">{top}</div> : null}
      <nav className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
        {sections.map((section, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: config statique
          <div key={i}>
            {section.label ? <p className="gd-section-label mb-3">{section.label}</p> : null}
            <ul className="space-y-1">
              {section.items.map((item) => (
                <li key={item.href}>
                  {item.children?.length ? (
                    <NavGroup item={item} activeHref={activeHref} LinkComponent={LinkComponent} />
                  ) : (
                    <NavLink
                      item={item}
                      active={item.href === activeHref}
                      LinkComponent={LinkComponent}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {bottom ? <div className="mt-auto border-t border-border p-4">{bottom}</div> : null}
    </div>
  );
}

function NavLink({
  item,
  active,
  LinkComponent,
  nested,
}: {
  item: NavItem;
  active: boolean;
  LinkComponent: LinkLike;
  nested?: boolean;
}) {
  return (
    <LinkComponent
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-field px-3 py-2.5 text-sm font-semibold transition-colors [&_svg]:size-[18px] [&_svg]:shrink-0",
        nested && "py-2 pl-4 text-[13px]",
        active ? "bg-accent-soft text-accent" : "text-fg hover:bg-surface-2",
      )}
    >
      <span className={cn(active ? "text-accent" : "text-muted")}>{item.icon}</span>
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge ? <Badge variant="solid">{item.badge}</Badge> : null}
    </LinkComponent>
  );
}

function NavGroup({
  item,
  activeHref,
  LinkComponent,
}: {
  item: NavItem;
  activeHref: string | null;
  LinkComponent: LinkLike;
}) {
  const childActive = item.children?.some((c) => c.href === activeHref) ?? false;
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-field px-3 py-2.5 text-sm font-semibold transition-colors hover:bg-surface-2 [&_svg]:size-[18px]",
          childActive ? "text-fg" : "text-fg",
        )}
        aria-expanded={open}
      >
        <span className="text-muted">{item.icon}</span>
        <span className="flex-1 truncate text-left">{item.label}</span>
        <ChevronDown className={cn("text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <ul className="mt-1 space-y-0.5 pl-3">
          {item.children?.map((child) => (
            <li key={child.href}>
              <NavLink
                item={child}
                active={child.href === activeHref}
                LinkComponent={LinkComponent}
                nested
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export interface SidebarUserProps {
  name: string;
  subtitle?: ReactNode;
  avatarUrl?: string | null;
  onClick?: () => void;
}

/** Bloc utilisateur en bas de sidebar (avatar, nom, ligne secondaire, chevron). */
export function SidebarUser({ name, subtitle, avatarUrl, onClick }: SidebarUserProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 rounded-card border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
    >
      <Avatar name={name} src={avatarUrl} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-fg">{name}</span>
        {subtitle ? <span className="block truncate text-xs text-muted">{subtitle}</span> : null}
      </span>
      <ChevronsUpDown className="size-4 text-faint" />
    </button>
  );
}

export interface SidebarServerOption {
  id: string;
  name: string;
  shortId: string;
  tone: StatusTone;
  href: string;
}

export interface SidebarServerSwitcherProps {
  current: SidebarServerOption;
  servers: readonly SidebarServerOption[];
  LinkComponent: LinkLike;
  /** Libellés, pour les applications traduites. */
  closeLabel?: string;
  emptyLabel?: string;
}

/**
 * Sélecteur de serveur en bas de sidebar. Il ne s'affiche que sur une page
 * serveur : ailleurs, aucun serveur n'est sélectionné et un sélecteur n'aurait
 * rien à désigner. Il porte le nom du serveur et son identifiant court, pas
 * celui du compte, puisque c'est le contexte de travail du moment.
 */
export function SidebarServerSwitcher({
  current,
  servers,
  LinkComponent,
  closeLabel = "Fermer la liste des serveurs",
  emptyLabel = "Aucun autre serveur.",
}: SidebarServerSwitcherProps) {
  const [open, setOpen] = useState(false);
  const others = servers.filter((s) => s.id !== current.id);

  return (
    <div className="relative">
      {open ? (
        <>
          {/* Capte le clic extérieur pour refermer la liste. */}
          <button
            type="button"
            aria-label={closeLabel}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul className="absolute bottom-full z-50 mb-2 max-h-72 w-full overflow-y-auto rounded-card border border-border bg-surface p-1 shadow-lg">
            {others.length === 0 ? (
              <li className="px-3 py-2.5 text-xs text-muted">{emptyLabel}</li>
            ) : (
              others.map((server) => (
                <li key={server.id}>
                  <LinkComponent
                    href={server.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 rounded-xs px-2.5 py-2 transition-colors hover:bg-surface-2"
                  >
                    <StatusDot tone={server.tone} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{server.name}</span>
                      <span className="gd-mono block truncate text-[11px] text-faint">
                        {server.shortId}
                      </span>
                    </span>
                  </LinkComponent>
                </li>
              ))
            )}
          </ul>
        </>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Serveur courant : ${current.name}. Changer de serveur.`}
        className="relative z-40 flex w-full cursor-pointer items-center gap-3 rounded-card border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
      >
        <StatusDot tone={current.tone} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg">{current.name}</span>
          <span className="gd-mono block truncate text-xs text-muted">{current.shortId}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-faint" />
      </button>
    </div>
  );
}
