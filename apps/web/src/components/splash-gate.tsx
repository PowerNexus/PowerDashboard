"use client";

import { SPLASH_CYCLE_MS, SplashScreen } from "@gamedashboard/ui";
import { useEffect, useState } from "react";

/**
 * Le fondu de sortie, compté en plus du cycle : on ne coupe pas la fin du
 * mouvement.
 */
const FADE_MS = 160;

/**
 * Tenue minimale du splash : le cycle complet, fondu compris.
 *
 * C'est une décision de marque, pas une limite technique. Le panel est souvent
 * prêt en deux cents millisecondes ; sans cette tenue, l'animation ne serait
 * qu'un clignotement — et une animation qu'on ne voit pas vaut moins que pas
 * d'animation du tout.
 *
 * La durée du cycle vient de `@gamedashboard/ui`, qui la donne aussi à la
 * feuille de style. Elle était recopiée ici du temps où l'animation était un
 * fichier d'images : deux nombres à tenir d'accord, avec un commentaire priant
 * qu'on y pense. Il n'y en a plus qu'un.
 */
const MINIMUM_HOLD_MS = SPLASH_CYCLE_MS + FADE_MS;

/**
 * L'écran de démarrage, tenu le temps que l'animation se joue.
 *
 * Monté dans la racine, il couvre la page pendant les premières secondes puis
 * s'efface. Distinct de `loading.tsx`, qui dépend du temps de rendu : celui-ci
 * garantit une durée, l'autre comble une attente. Les deux montrent la même
 * chose, si bien que le passage de l'un à l'autre ne se voit pas.
 *
 * Il ne se rejoue pas à chaque navigation : la racine ne se remonte pas quand
 * on passe d'une page à l'autre. Il revient à chaque chargement complet —
 * ouverture d'un onglet, rechargement — ce qui est exactement ce qu'on attend
 * d'un écran de démarrage.
 *
 * Rendu dès le serveur, et non après hydratation : apparaître une fois la page
 * déjà peinte ferait clignoter l'interface au lieu de la couvrir.
 *
 * Le nom lui est **passé** plutôt que lu d'un contexte : il s'affiche avant
 * tout fournisseur, et c'est la racine — qui résout déjà la marque du domaine
 * pour le titre de l'onglet — qui le lui donne.
 */
export function SplashGate({ name }: { name: string }) {
  const [phase, setPhase] = useState<"holding" | "leaving" | "gone">("holding");

  useEffect(() => {
    const leave = setTimeout(() => setPhase("leaving"), SPLASH_CYCLE_MS);
    const remove = setTimeout(() => setPhase("gone"), MINIMUM_HOLD_MS);

    return () => {
      clearTimeout(leave);
      clearTimeout(remove);
    };
  }, []);

  // Démonté, et pas seulement transparent : un calque invisible resté en place
  // intercepterait tous les clics de la page.
  if (phase === "gone") return null;

  return (
    <div
      className={phase === "leaving" ? "gd-splash-gate gd-splash-gate--leaving" : "gd-splash-gate"}
    >
      <SplashScreen cover name={name} />
    </div>
  );
}
