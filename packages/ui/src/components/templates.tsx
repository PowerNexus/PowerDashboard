import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Card, CardBody, CardHeader } from "./card";

/**
 * Les largeurs de page — et **le panel n'en emploie qu'une**.
 *
 * Il y en avait sept au jugé (720, 900, 960, 1000, 1100, 1200, 1400), puis
 * trois choisies par « catégorie de page » : listes au large, formulaires au
 * étroit. Cette seconde règle paraissait bonne et restait fausse, parce qu'une
 * page ne se regarde pas seule. « Sous-utilisateurs » à 1400 et « Paramètres »
 * à 960 sont deux entrées voisines du même menu : on passe de l'une à l'autre,
 * et tout le cadre se décale — l'en-tête, les cartes, les gouttières. Le saut
 * se lit comme un défaut d'affichage, et c'en est un.
 *
 * Le panel tient donc sur **`full`**, partout. La lisibilité des formulaires
 * se règle là où elle se pose — dans la grille du formulaire, qui passe à
 * trois colonnes quand la place le permet plutôt que d'étirer deux champs sur
 * toute la largeur — et non en rétrécissant la page autour d'eux.
 *
 * Les deux autres restent pour ce qui ne fait pas partie d'une section qu'on
 * parcourt : `readable` pour la page d'état publique, `narrow` pour un écran
 * qui ne porte qu'un message. Aucune n'a sa place dans le panel lui-même.
 */
export const PAGE_WIDTHS = { narrow: 720, readable: 960, full: 1400 } as const;

export type PageWidth = keyof typeof PAGE_WIDTHS;

export interface PageTemplateProps {
  header: ReactNode;
  /**
   * Ce qui prime sur la page entière, posé **avant** l'en-tête.
   *
   * Distinct de `toolbar` : un bandeau qui dit « rien n'obéit sur ce serveur »
   * ne se lit pas après le titre et les boutons qu'il désactive. On lirait
   * l'explication une fois le clic déjà tenté.
   */
  notice?: ReactNode;
  /** Bandeau, quota ou filtres placés entre l'en-tête et le contenu. */
  toolbar?: ReactNode;
  children: ReactNode;
  width?: PageWidth;
  className?: string;
}

/** Gabarit de page standard : en-tête, barre d'outils optionnelle, contenu. */
export function PageTemplate({
  header,
  notice,
  toolbar,
  children,
  width = "full",
  className,
}: PageTemplateProps) {
  return (
    <div
      className={cn("mx-auto flex w-full flex-col gap-6", className)}
      style={{ maxWidth: `${PAGE_WIDTHS[width]}px` }}
    >
      {notice}
      {header}
      {toolbar}
      {children}
    </div>
  );
}

export interface SettingsSectionProps {
  /**
   * Ancre de la section, pour qu'on puisse y renvoyer.
   *
   * L'écran des réglages est long : « allez dans les réglages » oblige à le
   * parcourir, alors qu'un lien peut déposer au bon endroit.
   */
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  tone?: "default" | "danger";
}

/** Section de réglages en carte. `tone: danger` pour les zones destructives. */
export function SettingsSection({
  id,
  title,
  description,
  children,
  actions,
  footer,
  tone = "default",
}: SettingsSectionProps) {
  return (
    <Card id={id} className={tone === "danger" ? "border-danger/40" : undefined}>
      <CardHeader
        title={<span className={tone === "danger" ? "text-danger-ink" : undefined}>{title}</span>}
        description={description}
        actions={actions}
      />
      <CardBody>{children}</CardBody>
      {footer ? (
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}
