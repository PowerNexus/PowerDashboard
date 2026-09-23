import { z } from "zod";

/**
 * Historique des mesures d'un serveur : plages, pas et forme de la réponse.
 *
 * La table `server_metrics` reçoit une ligne par minute et par serveur, gardée
 * trente jours. La lire telle quelle ferait 43 200 points sur la plage la plus
 * longue — plus de pixels qu'aucun écran n'en a, et autant de lignes à faire
 * transiter pour n'en afficher qu'une sur cent. Chaque plage a donc son pas,
 * choisi pour rester **autour de quelques centaines de points** : assez pour
 * voir un pic, assez peu pour que la réponse reste légère.
 *
 * La table vit ici, et non dans l'API : l'écran doit savoir combien de points
 * attendre et comment les espacer, et deux copies d'un même barème finissent
 * toujours par diverger.
 */

export const METRICS_RANGES = ["1h", "24h", "7d", "30d"] as const;
export const MetricsRange = z.enum(METRICS_RANGES);
export type MetricsRange = z.infer<typeof MetricsRange>;

/** Plage servie quand la requête n'en précise pas : une journée, la lecture la plus courante. */
export const DEFAULT_METRICS_RANGE: MetricsRange = "24h";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Durée couverte et pas d'agrégation, en secondes.
 *
 * - `1h` à la minute : c'est la cadence du relevé, rien de plus fin n'existe.
 * - `24h` à cinq minutes : 288 points.
 * - `7d` à l'heure : 168 points.
 * - `30d` à quatre heures : 180 points. Une heure en ferait 720, soit plus que
 *   la largeur utile d'un graphe ; quatre heures gardent encore la forme d'une
 *   journée (nuit, soirée) sans noyer la courbe.
 */
export const METRICS_RANGE_SPEC: Record<
  MetricsRange,
  { spanSeconds: number; stepSeconds: number }
> = {
  "1h": { spanSeconds: HOUR, stepSeconds: MINUTE },
  "24h": { spanSeconds: DAY, stepSeconds: 5 * MINUTE },
  "7d": { spanSeconds: 7 * DAY, stepSeconds: HOUR },
  "30d": { spanSeconds: 30 * DAY, stepSeconds: 4 * HOUR },
};

/** Pas d'agrégation d'une plage, en secondes. */
export function metricsStepSeconds(range: MetricsRange): number {
  return METRICS_RANGE_SPEC[range].stepSeconds;
}

/** Nombre de points d'une série : un par pas, toujours le même pour une plage donnée. */
export function metricsPointCount(range: MetricsRange): number {
  const { spanSeconds, stepSeconds } = METRICS_RANGE_SPEC[range];
  return spanSeconds / stepSeconds;
}

/**
 * Les pas d'une plage, à un instant donné.
 *
 * Les pas sont **alignés sur l'époque Unix**, pas sur l'instant de la requête :
 * deux lectures à trente secondes d'écart rendent alors les mêmes pas, et une
 * courbe ne « glisse » pas à chaque rafraîchissement. C'est aussi ce que fait
 * `date_bin(…, 'epoch')` côté base — les deux calculs doivent tomber sur les
 * mêmes bornes, sans quoi aucune mesure ne rejoindrait son pas.
 *
 * Le dernier pas est celui qui contient `now` : il est en cours, donc partiel,
 * et c'est dit par son `samples` plutôt que caché.
 */
export function metricsBuckets(
  range: MetricsRange,
  now: Date,
): { first: Date; last: Date; stepSeconds: number; count: number } {
  const stepSeconds = metricsStepSeconds(range);
  const count = metricsPointCount(range);
  const stepMs = stepSeconds * 1000;
  const last = Math.floor(now.getTime() / stepMs) * stepMs;
  return {
    first: new Date(last - (count - 1) * stepMs),
    last: new Date(last),
    stepSeconds,
    count,
  };
}

/**
 * Un pas de la série.
 *
 * **Chaque mesure est nullable, et nul veut dire « pas mesuré »** — jamais
 * zéro. Un serveur arrêté, un node muet, un relevé qui a échoué : autant de
 * pas sans valeur, que l'écran doit montrer comme des trous. Remplir par zéro
 * dessinerait un serveur au repos là où l'on ne sait rien, et c'est
 * précisément la confiance qu'un graphe ne doit pas inspirer (ADR 0005).
 *
 * `samples` compte les relevés tombés dans le pas, quel que soit l'état du
 * conteneur : il permet de distinguer « serveur arrêté » (des relevés, mais pas
 * de charge mesurée) de « rien reçu du tout ».
 */
export const MetricsHistoryPoint = z.object({
  /** Début du pas, ISO 8601. */
  at: z.string(),
  samples: z.number().int().nonnegative(),
  cpuAvgPct: z.number().nonnegative().nullable(),
  cpuMaxPct: z.number().nonnegative().nullable(),
  memoryAvgBytes: z.number().nonnegative().nullable(),
  memoryMaxBytes: z.number().nonnegative().nullable(),
  /** Occupation disque la plus haute du pas : elle se mesure même serveur arrêté. */
  diskBytes: z.number().nonnegative().nullable(),
  /** Débits moyens, en octets par seconde, déduits des compteurs cumulés de Wings. */
  networkRxBytesPerSec: z.number().nonnegative().nullable(),
  networkTxBytesPerSec: z.number().nonnegative().nullable(),
  /** Nuls tant qu'aucune sonde de jeu n'écrit de joueurs (§8.2). */
  playersAvg: z.number().nonnegative().nullable(),
  playersMax: z.number().int().nonnegative().nullable(),
});
export type MetricsHistoryPoint = z.infer<typeof MetricsHistoryPoint>;

export const MetricsHistory = z.object({
  range: MetricsRange,
  stepSeconds: z.number().int().positive(),
  /** Début du premier pas et fin de la plage, ISO 8601. */
  from: z.string(),
  to: z.string(),
  /** Tous les pas de la plage, dans l'ordre, trous compris. */
  points: z.array(MetricsHistoryPoint),
});
export type MetricsHistory = z.infer<typeof MetricsHistory>;
