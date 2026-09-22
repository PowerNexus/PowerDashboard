"use client";

import { useEffect } from "react";

/**
 * Enregistre l'agent de service, et le retire quand il n'a rien à faire là.
 *
 * **La désinscription compte autant que l'inscription.** Un agent enregistré
 * une fois survit aux déploiements : s'il était retiré du produit, il
 * continuerait d'intercepter les requêtes des navigateurs qui l'ont gardé, et
 * il n'existerait plus aucun moyen de les en défaire. En développement, où
 * l'on ne veut pas de cache du tout, il est donc activement désinscrit.
 *
 * L'enregistrement est repoussé après le chargement : il déclenche des
 * requêtes réseau, et les faire pendant la première peinture retarderait
 * l'écran que la personne attend.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((agents) => Promise.all(agents.map((agent) => agent.unregister())))
        .catch(() => undefined);
      return;
    }

    const inscrire = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        /*
         * L'échec est sans conséquence et sans message.
         *
         * Un navigateur en navigation privée, une politique d'entreprise, un
         * `file://` : autant de refus normaux. Le panel fonctionne
         * exactement pareil sans agent — le signaler inquiéterait pour rien.
         */
      });
    };

    if (document.readyState === "complete") {
      inscrire();
      return;
    }
    window.addEventListener("load", inscrire);
    return () => window.removeEventListener("load", inscrire);
  }, []);

  return null;
}
