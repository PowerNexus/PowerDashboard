"use client";

import { UPTIME_WINDOW_DAYS } from "@gamedashboard/contracts";
import { useFormatter, useTranslations } from "next-intl";

/**
 * Disponibilité d'un composant de la page de statut.
 *
 * Le chiffre porte toujours sa période : « sur 90 jours », ou « depuis le … »
 * quand l'historique est plus court. Sans elle, 100 % après une heure
 * d'observation se lirait comme trois mois sans panne.
 */
export function StatusUptime({ uptime }: { uptime?: { ratio: number | null; since: string } }) {
  const t = useTranslations("status");
  const format = useFormatter();
  if (!uptime) return null;

  if (uptime.ratio === null) {
    return <span className="text-faint text-xs">{t("uptimeTooEarly")}</span>;
  }

  // Tronqué, jamais arrondi vers le haut : 99,996 % ne s'affiche pas « 100 % ».
  const value = format.number(Math.floor(uptime.ratio * 10_000) / 10_000, {
    style: "percent",
    maximumFractionDigits: 2,
  });
  const full =
    Date.now() - new Date(uptime.since).getTime() >= (UPTIME_WINDOW_DAYS - 1) * 86_400_000;

  return (
    <span className="gd-mono text-muted text-xs">
      {full
        ? t("uptimeWindow", { value, days: UPTIME_WINDOW_DAYS })
        : t("uptimeSince", {
            value,
            date: format.dateTime(new Date(uptime.since), { dateStyle: "medium" }),
          })}
    </span>
  );
}
