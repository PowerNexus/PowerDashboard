"use client";

import { Button } from "@gamedashboard/ui";
import { Eye, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { stopImpersonation } from "@/server/api/session";

/**
 * Bandeau de prise en main.
 *
 * **Volontairement impossible à manquer et impossible à fermer.** Un agent qui
 * oublie qu'il regarde le compte d'un client finit par lire ses fichiers en
 * croyant lire les siens, puis par s'étonner que le panel refuse tout. Le
 * bandeau reste donc collé en haut de chaque page, sans croix, jusqu'au retour.
 *
 * Il dit aussi ce qui est refusé — la lecture seule — parce que le motif se
 * découvrirait sinon au premier clic, sous la forme d'un refus incompréhensible.
 */
export function ImpersonationBanner({ account }: { account: string }) {
  const t = useTranslations("impersonation");
  const [pending, startTransition] = useTransition();

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-warning/40 border-b bg-warning-soft px-4 py-2 text-sm">
      <span className="flex items-center gap-2 text-warning-ink [&_svg]:size-4">
        <Eye />
        <span>
          {t("viewing", { account })} — <strong>{t("readOnly")}</strong>
        </span>
      </span>

      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await stopImpersonation();
            /*
             * Rechargement complet plutôt qu'un simple `refresh`.
             *
             * Le compte vient de changer, et avec lui le rôle, la navigation et
             * tout ce que le rendu serveur avait déjà produit. Un rafraîchi
             * partiel laisserait des morceaux de l'écran du client dans celui
             * de l'agent.
             */
            window.location.href = "/admin/users";
          })
        }
      >
        <LogOut /> {t("leave")}
      </Button>
    </div>
  );
}
