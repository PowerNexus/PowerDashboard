"use client";

import {
  DEFAULT_METRICS_RANGE,
  type MetricsHistory,
  type MetricsRange,
} from "@gamedashboard/contracts";
import { useEffect, useState, useTransition } from "react";
import { loadMetricsHistory } from "@/server/api/metrics";

/**
 * L'historique d'un serveur, rechargé à chaque changement de plage.
 *
 * La série précédente reste affichée pendant le chargement de la suivante :
 * un graphe qui disparaît à chaque clic fait sauter la page, et on perd
 * l'endroit qu'on regardait. Seule une réponse **à jour** la remplace — un
 * clic rapide sur 7 j puis 1 h ne doit pas laisser la semaine s'afficher sous
 * l'étiquette « 1 h » parce qu'elle est arrivée la dernière.
 */
export function useMetricsHistory(serverId: string) {
  const [range, setRange] = useState<MetricsRange>(DEFAULT_METRICS_RANGE);
  const [history, setHistory] = useState<MetricsHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let courant = true;
    startTransition(async () => {
      const result = await loadMetricsHistory(serverId, range);
      if (!courant) return;
      setError(result.error);
      setHistory(result.history);
    });
    return () => {
      courant = false;
    };
  }, [serverId, range]);

  return { range, setRange, history, error, pending };
}
