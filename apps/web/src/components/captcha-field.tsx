"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

/**
 * Contrôle anti-automate (Cloudflare Turnstile).
 *
 * **Ne se rend que si la plateforme a posé une clé de site.** C'est le point
 * important : un contrôle affiché mais que l'API n'exige pas apprend à
 * l'utilisateur qu'on peut l'ignorer, et un contrôle exigé mais absent de
 * l'écran rend le formulaire impossible à valider. La clé vient donc de la même
 * décision que celle qui fera refuser la requête.
 *
 * Le jeton est déposé dans un champ caché du formulaire. Les formulaires de ce
 * panel passent par des actions serveur, jamais par un appel direct à l'API :
 * le jeton voyage donc comme les autres champs, et c'est le serveur qui le
 * relaie.
 */
declare global {
  interface Window {
    turnstile?: {
      render(element: HTMLElement, options: Record<string, unknown>): string;
      remove(widgetId: string): void;
    };
  }
}

export function CaptchaField({ siteKey }: { siteKey: string | null }) {
  const holder = useRef<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);

  useEffect(() => {
    if (siteKey === null) return;

    /*
     * Le script est chargé à part et peut arriver après ce rendu.
     *
     * On tente à l'affichage puis on retente à intervalle court plutôt que de
     * s'accrocher à un rappel global : plusieurs formulaires peuvent cohabiter
     * — la page de connexion porte le sien, la page d'inscription le sien — et
     * un rappel unique nommé sur `window` ne saurait pas lequel servir.
     */
    const mount = () => {
      if (widget.current !== null || !holder.current || !window.turnstile) return false;
      widget.current = window.turnstile.render(holder.current, {
        sitekey: siteKey,
        // Le nom du champ : Turnstile écrit lui-même l'entrée cachée dans le
        // formulaire parent, ce qui évite d'avoir à suivre le jeton en état.
        "response-field-name": "captchaToken",
      });
      return true;
    };

    if (mount()) return;
    const timer = setInterval(() => {
      if (mount()) clearInterval(timer);
    }, 200);

    return () => {
      clearInterval(timer);
      // Retiré à la sortie : un widget laissé derrière réenregistre un champ
      // caché dans un formulaire qui n'existe plus.
      if (widget.current !== null) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]);

  if (siteKey === null) return null;

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
      />
      <div ref={holder} className="flex justify-center" />
    </>
  );
}
