"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { cn } from "../lib/cn";

/**
 * Signal « le panel travaille », et la barre qui le montre.
 *
 * Trois pièces qui n'ont de sens qu'ensemble :
 *
 * - `NavigationProgressProvider` tient le compte, dans la coquille — donc au
 *   même endroit que le header, qui reste monté d'une page à l'autre ;
 * - `NavigationPending` ne dessine rien : monté, il déclare une attente ;
 *   démonté, il la retire ;
 * - `NavigationProgressBar` lit ce compte et s'affiche.
 *
 * Le découpage vient de là : ce qui *sait* qu'on attend (la frontière de
 * chargement d'un segment, remplacée dès que la page est prête) n'est pas ce
 * qui doit *l'afficher* (le bord du header, bien au-dessus dans l'arbre).
 *
 * Un compteur et non un booléen : deux segments peuvent se charger en même
 * temps, et le premier arrivé n'a pas à éteindre la barre pour le second.
 */
interface NavigationProgressCtx {
  pending: boolean;
  /** Déclare une attente, et rend la fonction qui la retire. */
  hold: () => () => void;
}

const Ctx = createContext<NavigationProgressCtx>({
  pending: false,
  // Hors de la coquille, déclarer une attente ne casse rien : cela ne fait
  // simplement rien. Une page sans header n'a pas de bord où l'afficher.
  hold: () => () => {},
});

export function NavigationProgressProvider({ children }: { children: ReactNode }) {
  const [holds, setHolds] = useState(0);

  const hold = useCallback(() => {
    setHolds((n) => n + 1);
    let released = false;
    return () => {
      // Une libération ne compte qu'une fois : en mode strict, React monte et
      // démonte deux fois, et un décrément en double ferait passer le compte
      // sous zéro — la barre s'éteindrait alors qu'une attente court encore.
      if (released) return;
      released = true;
      setHolds((n) => Math.max(0, n - 1));
    };
  }, []);

  return <Ctx.Provider value={{ pending: holds > 0, hold }}>{children}</Ctx.Provider>;
}

/**
 * Déclare une attente tant que ce composant est monté.
 *
 * À placer dans un `loading.tsx` : Next le monte quand un segment se charge et
 * le remplace dès que la page est prête. C'est donc l'état de navigation de
 * Next lui-même qu'on observe, et non une devinette — ce qui vaut aussi bien
 * pour un lien cliqué que pour un `router.push`.
 */
export function NavigationPending() {
  const { hold } = useContext(Ctx);
  useEffect(() => hold(), [hold]);
  return null;
}

/**
 * La barre, sur le bord bas du header.
 *
 * Sans progression chiffrée, et c'est délibéré : le panel ne sait pas combien
 * de temps son API mettra à répondre. Une barre qui prétend être à 70 % l'a
 * inventé, et le fait voir dès qu'elle s'y arrête. Un mouvement continu dit la
 * seule chose vraie — ça travaille — sans rien promettre.
 */
export function NavigationProgressBar({ className }: { className?: string }) {
  const { pending } = useContext(Ctx);

  return (
    <div
      className={cn("gd-navprogress", pending && "gd-navprogress--active", className)}
      // Indéterminée : pas de `aria-valuenow`, sans quoi une valeur figée
      // serait lue comme une progression arrêtée.
      role="progressbar"
      aria-busy={pending}
      aria-label="Chargement de la page"
      aria-hidden={!pending}
    >
      <span className="gd-navprogress-rainbow" />
      <span className="gd-navprogress-comet" />
    </div>
  );
}
