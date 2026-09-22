"use client";

import { AlertBanner } from "@gamedashboard/ui";
import { useEffect, useState } from "react";
import type { Announcement } from "@/server/api/announcements";

/**
 * Annonces de la plateforme, en haut du panel.
 *
 * **Refermables, et la fermeture est retenue par navigateur.** Une annonce
 * qu'on ne peut pas écarter devient un papier peint : au bout de trois jours
 * personne ne la lit plus, y compris celle qui arrivera après. La refermer est
 * donc ce qui garde la suivante lisible.
 *
 * Le souvenir est rangé dans `localStorage`, et c'est le bon endroit : c'est
 * une commodité propre à un navigateur — « j'ai lu ça » — et non un état que le
 * panel doit connaître. La ranger côté serveur demanderait une table, une
 * migration et une écriture par lecteur et par annonce, pour une information
 * dont personne n'a l'usage.
 */
const STORAGE_KEY = "gd.announcements.dismissed";

const TONE = {
  info: "info",
  warning: "warning",
  critical: "danger",
} as const;

export function AnnouncementBanners({ announcements }: { announcements: Announcement[] }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  /*
   * Lu après le montage, jamais au rendu.
   *
   * `localStorage` n'existe pas côté serveur : le lire pendant le rendu ferait
   * diverger la page rendue et la page hydratée. On affiche donc tout au
   * premier passage, puis on retire ce qui a été fermé — le clignotement
   * possible vaut mieux qu'une erreur d'hydratation.
   */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      setDismissed(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      // Navigation privée, stockage refusé : on affiche tout, ce qui est le
      // comportement le moins surprenant.
    }
    setReady(true);
  }, []);

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Sans conséquence : l'annonce réapparaîtra au prochain chargement.
    }
  };

  const shown = ready ? announcements.filter((a) => !dismissed.includes(a.id)) : announcements;
  if (shown.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 px-4 pt-4">
      {shown.map((announcement) => (
        <AlertBanner
          key={announcement.id}
          variant={TONE[announcement.level]}
          title={announcement.title}
          dismissible
          onDismiss={() => dismiss(announcement.id)}
        >
          {/* Le corps est rendu tel quel, en texte.
              Pas de Markdown interprété : ce texte vient d'un administrateur,
              mais il traverse une base et finirait par porter du HTML le jour
              où quelqu'un colle un paragraphe copié ailleurs. Le rendre en
              texte coûte la mise en forme et ferme la question. */}
          <span className="whitespace-pre-line">{announcement.bodyMd}</span>
        </AlertBanner>
      ))}
    </div>
  );
}
