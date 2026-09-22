"use client";

import { Button, Dialog, DialogContent } from "@gamedashboard/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/**
 * L'avertissement de bêta, montré une fois par navigateur.
 *
 * **Pourquoi il n'est pas un bandeau.** Un bandeau se referme d'un geste
 * distrait et se lit rarement ; ce texte dit deux choses qu'il vaut mieux
 * avoir lues avant de confier un serveur au panel — que le produit est en
 * essai permanent, et qui le tient. Une fenêtre à valider oblige à ce geste,
 * une seule fois.
 *
 * **Pourquoi le stockage local et non un cookie.** Rien ici ne regarde le
 * serveur : personne n'a besoin de savoir qui a lu l'avertissement, et un
 * cookie partirait avec chaque requête pour ne rien y faire. Le revers est
 * assumé — la fenêtre reparaît dans un autre navigateur, ou après un nettoyage
 * des données du site.
 *
 * **Pourquoi elle ne s'affiche qu'après le montage.** L'état de lecture n'est
 * connu que du navigateur : la rendre au serveur la ferait apparaître une
 * fraction de seconde à ceux qui l'ont déjà acceptée.
 */
const CLE = "gd-beta-notice";

/** Change quand le texte change : une nouvelle version se remontre à tous. */
const VERSION = "1";

export function BetaNotice() {
  const t = useTranslations("betaNotice");
  const [ouvert, setOuvert] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(CLE) !== VERSION) setOuvert(true);
    } catch {
      /*
       * Navigation privée, stockage refusé par une politique : on montre la
       * fenêtre. Se taire au moindre doute reviendrait à ne jamais avertir
       * celui dont le navigateur est le plus fermé — et l'avertissement, lui,
       * le concerne autant que les autres.
       */
      setOuvert(true);
    }
  }, []);

  const accepter = () => {
    setOuvert(false);
    try {
      localStorage.setItem(CLE, VERSION);
    } catch {
      // Elle reparaîtra au prochain chargement. C'est désagréable, et c'est
      // moins grave que de perdre l'avertissement.
    }
  };

  return (
    <Dialog
      open={ouvert}
      // La fenêtre ne se ferme que par le bouton : pas d'échappement, pas de
      // clic à côté. C'est le seul endroit du panel où cette raideur se
      // justifie — ailleurs, elle enfermerait quelqu'un dans un formulaire.
      onOpenChange={(etat) => {
        if (!etat) accepter();
      }}
    >
      <DialogContent
        title={t("title")}
        description={t("lead")}
        size="lg"
        closeLabel={t("accept")}
        footer={
          <Button onClick={accepter} autoFocus>
            {t("accept")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4 text-fg text-sm leading-relaxed">
          <p>{t("stability")}</p>
          <p>{t("authorship")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
