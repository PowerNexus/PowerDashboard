"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Redemande au serveur les données de la page, à intervalle régulier.
 *
 * **Vieillir une donnée n'est pas la rafraîchir.** Plusieurs écrans battaient
 * déjà la seconde pour recalculer un état à partir de l'instant reçu au
 * premier rendu — l'âge d'un battement de node, par exemple. Le calcul était
 * juste et le résultat faux : la valeur de départ, elle, ne changeait jamais.
 * Une page laissée ouverte finissait donc par afficher « Injoignable » sur un
 * node parfaitement vivant, avec un « il y a 11 minutes » qui ne mesurait que
 * le temps passé devant l'écran.
 *
 * `router.refresh()` rejoue les composants serveur et remplace leurs
 * propriétés **sans démonter les composants client** : une recherche en cours
 * de frappe, un menu ouvert, une section repliée survivent au rafraîchissement.
 * C'est ce qui permet de le faire en continu plutôt qu'à la demande.
 */

/**
 * Cadence par défaut, alignée sur le battement des nodes.
 *
 * Interroger plus souvent que la source ne se met à jour ne fait que produire
 * du rendu pour une réponse identique ; moins souvent laisse voir un état que
 * le panel connaît déjà comme faux.
 */
export const AUTO_REFRESH_MS = 10_000;

export function useAutoRefresh(intervalMs: number = AUTO_REFRESH_MS): void {
  const router = useRouter();

  useEffect(() => {
    /*
     * Rien ne tourne derrière un onglet caché.
     *
     * Un panel reste ouvert des heures dans un onglet qu'on ne regarde pas :
     * sans cette garde, chaque onglet oublié interrogerait l'API six fois par
     * minute, indéfiniment, pour un écran que personne ne lit. Le navigateur
     * ralentit déjà les minuteurs en arrière-plan, mais il ne les arrête pas,
     * et « ralenti » multiplié par le nombre d'onglets reste une charge.
     */
    function tick(): void {
      if (document.visibilityState === "visible") router.refresh();
    }

    const timer = setInterval(tick, intervalMs);

    /*
     * Le retour sur l'onglet rafraîchit **tout de suite**.
     *
     * C'est le moment exact où la donnée est la plus vieille et où quelqu'un
     * la regarde. Attendre le prochain tour ferait voir en premier ce qu'on
     * vient précisément de corriger : un écran figé sur l'état d'il y a une
     * heure.
     */
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, intervalMs]);
}

/**
 * Le même rafraîchissement, posable dans une page serveur.
 *
 * Ne rend rien : il n'existe que pour porter le crochet là où il n'y a aucun
 * composant client à qui le confier. Plusieurs écrans du panel sont entièrement
 * rendus par le serveur — l'accueil, la vue d'ensemble — et n'avaient donc
 * aucun endroit où accrocher un minuteur.
 */
export function AutoRefresh({ intervalMs }: { intervalMs?: number }) {
  useAutoRefresh(intervalMs);
  return null;
}
