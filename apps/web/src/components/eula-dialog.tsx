"use client";

import { AlertBanner, Button, Dialog, DialogContent, Switch } from "@gamedashboard/ui";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

/**
 * Acceptation du contrat de licence de Minecraft.
 *
 * Un bouton dans un bandeau ne suffit pas : ce serait un clic au milieu
 * d'autres clics, sur un écran qui parle de tout autre chose. Ce qui rend une
 * acceptation opposable, c'est un **acte distinct** — le texte présenté avant,
 * une case à cocher qui n'est pas cochée d'avance, et un bouton qui reste
 * inerte tant qu'elle ne l'est pas.
 *
 * Trois choses que cette fenêtre fait, et qu'un bandeau ne faisait pas :
 *
 * 1. Elle dit **ce qui est accepté** et **au nom de qui**, avant le geste.
 * 2. Elle donne le texte à lire, sur le site de Mojang, sans le paraphraser :
 *    un résumé maison n'a aucune valeur et pourrait induire en erreur.
 * 3. Elle annonce que l'acceptation sera inscrite au journal avec sa date.
 *
 * La case n'est jamais pré-cochée. Une case pré-cochée n'est pas un
 * consentement : c'est une case que l'on n'a pas décochée.
 */
export function EulaDialog({
  open,
  onOpenChange,
  url,
  pending,
  onAccept,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  pending: boolean;
  onAccept: () => void;
}) {
  const t = useTranslations("engine");
  const tc = useTranslations("common");
  const checkboxId = useId();
  const [agreed, setAgreed] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // La case repart décochée à chaque ouverture : un consentement ne se
        // garde pas en mémoire d'une fenêtre à l'autre.
        if (!next) setAgreed(false);
        onOpenChange(next);
      }}
    >
      <DialogContent
        title={t("eulaDialogTitle")}
        description={t("eulaDialogIntro")}
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("cancel")}
            </Button>
            <Button disabled={!agreed || pending} onClick={onAccept}>
              {t("eulaAccept")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {/* Le texte n'est pas reproduit ni résumé : seul celui de Mojang fait
              foi, et une paraphrase pourrait induire en erreur sur ce qu'on
              accepte. */}
          <a
            className="inline-flex items-center gap-2 self-start text-accent text-sm underline"
            href={url}
            target="_blank"
            rel="noreferrer noopener"
          >
            <ExternalLink className="size-4" /> {t("eulaRead")}
          </a>

          <AlertBanner variant="info" title={t("eulaWhoTitle")}>
            {t("eulaWhoBody")}
          </AlertBanner>

          <div className="flex items-start gap-3 rounded-field border border-border p-3">
            <Switch id={checkboxId} checked={agreed} onCheckedChange={setAgreed} />
            <label className="text-fg text-sm leading-relaxed" htmlFor={checkboxId}>
              {t("eulaConfirm")}
            </label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
