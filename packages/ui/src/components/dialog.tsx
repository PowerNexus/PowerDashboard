"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { Input } from "./input";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export interface DialogContentProps {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Libellé du bouton de fermeture, pour les applications traduites. */
  closeLabel?: string;
  className?: string;
}

const SIZES = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" };

export function DialogContent({
  title,
  description,
  children,
  footer,
  size = "md",
  closeLabel = "Fermer",
  className,
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in" />
      <DialogPrimitive.Content
        className={cn(
          /*
           * La fenêtre ne dépasse jamais l'écran, et c'est le **corps** qui
           * défile.
           *
           * Sans hauteur maximale, une fenêtre riche — le classement des nodes,
           * la recherche d'eggs — déborde en haut et en bas. Centrée par
           * `-translate-y-1/2`, elle sort d'abord par le haut : le titre et la
           * croix de fermeture passent hors de l'écran, et rien ne défile
           * puisque le débordement est celui d'un élément positionné.
           *
           * `dvh` et non `vh` : sur un téléphone, la barre d'adresse rend `vh`
           * plus grand que la zone réellement visible, ce qui reproduirait le
           * défaut exactement là où il gêne le plus.
           */
          "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-border bg-surface shadow-lg",
          SIZES[size],
          className,
        )}
      >
        {/* `shrink-0` sur l'en-tête et le pied : ils restent visibles pendant
            que le corps défile. Le titre dit où l'on est, le pied porte
            l'action — les perdre au défilement, c'est perdre la fenêtre. */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <DialogPrimitive.Title className="text-base font-semibold text-fg">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-sm text-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            className="cursor-pointer text-muted transition-colors hover:text-fg"
            aria-label={closeLabel}
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
        {/* `min-h-0` : sans lui, un enfant flex refuse de rétrécir sous sa
            taille de contenu et le débordement repasse sur la fenêtre entière. */}
        {children ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        ) : null}
        {footer ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-6 py-4">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  destructive?: boolean;
  /** Si fourni, l'utilisateur doit saisir exactement ce texte pour confirmer. */
  requireTyped?: string;
  loading?: boolean;
}

/**
 * Confirmation d'action. Pour les actions destructives, `requireTyped` impose de
 * retaper le nom de la ressource, comme sur GitHub.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  onConfirm,
  destructive,
  requireTyped,
  loading,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const blocked = requireTyped !== undefined && typed !== requireTyped;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setTyped("");
        onOpenChange(v);
      }}
    >
      <DialogContent
        size="sm"
        title={title}
        description={description}
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
            <Button
              variant={destructive ? "danger" : "primary"}
              disabled={blocked}
              loading={loading}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        {requireTyped !== undefined ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">
              Saisissez <span className="gd-mono font-semibold text-fg">{requireTyped}</span> pour
              confirmer.
            </p>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireTyped}
              autoComplete="off"
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
