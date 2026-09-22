"use client";

import { AlertBanner, Button } from "@gamedashboard/ui";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { acceptEula, type EulaState } from "@/server/api/engine";
import { EulaDialog } from "./eula-dialog";

/**
 * Le rappel du contrat de licence, sur **toutes** les pages du serveur.
 *
 * Il vivait d'abord sur le seul écran « Moteur », et c'était une erreur de
 * conception : le message qui envoie ici — « You need to agree to the EULA » —
 * apparaît dans la **console**. On voyait donc le problème à un endroit et sa
 * solution à un autre, sans rien pour relier les deux.
 *
 * Le bandeau est donc monté dans le cadre commun du serveur : tant que le
 * contrat n'est pas accepté, ce serveur ne démarre pas, quelle que soit la page
 * qu'on regarde. Une fois accepté, il disparaît partout.
 *
 * Il n'accepte rien lui-même : il ouvre la fenêtre où l'acte a lieu.
 */
export function EulaNotice({ serverId, eula }: { serverId: string; eula: EulaState | null }) {
  const t = useTranslations("engine");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Rien à dire quand le serveur n'est pas concerné, ou quand c'est déjà fait.
  if (!eula?.applicable || eula.accepted !== false) return null;

  return (
    /*
     * Le bandeau est cadré comme une page, et non comme le cadre entier.
     *
     * Il est monté au-dessus de `children`, donc à l'intérieur de la zone
     * principale mais **hors** du `PageTemplate` de la page. Sans cette
     * contrainte il s'étalait d'un bord à l'autre pendant que le contenu
     * restait centré à 1400 pixels : deux alignements différents sur le même
     * écran, ce qui se voit immédiatement.
     *
     * `mb-6` reprend l'espacement que `PageTemplate` met entre ses blocs, pour
     * que le bandeau ne colle pas au titre de la page.
     */
    <div className="mx-auto mb-6 w-full max-w-[1400px]">
      <AlertBanner variant="warning" title={t("eulaTitle")}>
        <div className="flex flex-col gap-3">
          <p>{t("eulaBody")}</p>
          {error ? <p className="text-danger-ink text-sm">{error}</p> : null}
          <Button size="sm" className="self-start" onClick={() => setOpen(true)}>
            {t("eulaReview")}
          </Button>
        </div>
      </AlertBanner>

      <EulaDialog
        open={open}
        onOpenChange={setOpen}
        url={eula.url}
        pending={pending}
        onAccept={() =>
          startTransition(async () => {
            const result = await acceptEula(serverId);
            setError(result.error);
            setOpen(false);
            if (!result.error) router.refresh();
          })
        }
      />
    </div>
  );
}
