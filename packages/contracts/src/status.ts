/**
 * Page de statut publique.
 *
 * Elle répond à une question posée depuis l'extérieur, souvent au pire moment :
 * « est-ce vous ou est-ce moi ? ». D'où deux principes qui gouvernent tout ce
 * fichier.
 *
 * **Elle ne suppose aucune session.** Un client qui ne parvient pas à se
 * connecter doit pouvoir la lire — c'est précisément la panne qu'il veut
 * comprendre. Une page de statut derrière une authentification ne sert que
 * lorsqu'on n'en a pas besoin.
 *
 * **Elle n'invente rien.** Ce qui est affiché vient du heartbeat des nodes ou
 * d'un incident rédigé par l'exploitant. La disponibilité chiffrée se calcule
 * sur les pannes consignées (`node_outages`), et **seulement depuis qu'elles
 * le sont** : la page dit « depuis le … » plutôt que de compter comme sans
 * panne une période dont le panel ne sait rien. Un chiffre plausible mais faux
 * sur une page de statut coûte plus cher que son absence.
 */

/** Gravité d'un incident, de la moins grave à la plus grave. */
export const INCIDENT_IMPACTS = ["none", "minor", "major", "critical"] as const;
export type IncidentImpact = (typeof INCIDENT_IMPACTS)[number];

/**
 * Où en est la résolution.
 *
 * Reprend le vocabulaire commun des pages de statut — on cherche, on a trouvé,
 * on surveille, c'est réglé. Un intégrateur ou un client qui a déjà lu une
 * page de statut ailleurs n'a rien à réapprendre.
 */
export const INCIDENT_STATES = ["investigating", "identified", "monitoring", "resolved"] as const;
export type IncidentState = (typeof INCIDENT_STATES)[number];

export function isIncidentImpact(value: string): value is IncidentImpact {
  return (INCIDENT_IMPACTS as readonly string[]).includes(value);
}

export function isIncidentState(value: string): value is IncidentState {
  return (INCIDENT_STATES as readonly string[]).includes(value);
}

/** Un incident est clos quand sa résolution est annoncée, pas quand la panne cesse. */
export function isIncidentOpen(state: IncidentState): boolean {
  return state !== "resolved";
}

/** Une mise à jour d'incident : ce qu'on savait, et à quelle heure. */
export interface IncidentUpdate {
  state: IncidentState;
  body: string;
  at: string;
}

/**
 * État global de la plateforme.
 *
 * `maintenance` est distinct de `degraded` : une intervention annoncée n'est
 * pas une panne, et les confondre apprend aux clients à ignorer la page.
 */
export const PLATFORM_STATES = ["operational", "maintenance", "degraded", "down"] as const;
export type PlatformState = (typeof PLATFORM_STATES)[number];

/** Ordre de gravité. Sert à retenir le pire état, jamais à faire une moyenne. */
const PLATFORM_SEVERITY: Record<PlatformState, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  down: 3,
};

const IMPACT_AS_PLATFORM: Record<IncidentImpact, PlatformState> = {
  none: "operational",
  minor: "degraded",
  major: "degraded",
  critical: "down",
};

/**
 * L'état affiché en haut de la page.
 *
 * C'est **le pire** de ce qui est observé et de ce qui est déclaré, jamais une
 * moyenne : une plateforme dont un node sur dix est à terre n'est pas
 * « opérationnelle à 90 % » pour le client dont le serveur est sur ce node.
 *
 * Les deux sources comptent, et dans cet ordre de préséance : un incident
 * rédigé ne peut qu'aggraver l'état, jamais l'améliorer. Si le heartbeat dit
 * qu'un node est muet, aucune rédaction ne peut afficher « tout va bien » —
 * c'est ce qui empêche la page de mentir par omission.
 */
export function platformState(input: {
  components: readonly PlatformState[];
  openIncidents: readonly IncidentImpact[];
}): PlatformState {
  const candidates: PlatformState[] = [
    "operational",
    ...input.components,
    ...input.openIncidents.map((impact) => IMPACT_AS_PLATFORM[impact]),
  ];

  return candidates.reduce((worst, current) =>
    PLATFORM_SEVERITY[current] > PLATFORM_SEVERITY[worst] ? current : worst,
  );
}

/** Traduit l'état d'un node en état de composant, pour la page publique. */
export function componentStateOf(node: {
  maintenance: boolean;
  lastHeartbeatAt: string | null;
  lostAfterMs: number;
  now?: number;
}): PlatformState {
  /**
   * Jamais joint ⇒ hors service.
   *
   * Contrairement au veilleur, qui se tait faute d'avoir rien perdu, la page
   * publique doit dire ce qu'elle voit : un node déclaré que le daemon n'a
   * jamais contacté n'héberge rien d'utilisable, et l'annoncer « opérationnel »
   * serait faux pour qui le lit.
   */
  if (node.lastHeartbeatAt === null) return "down";

  const age = (node.now ?? Date.now()) - new Date(node.lastHeartbeatAt).getTime();
  if (age > node.lostAfterMs) return "down";
  // Le fait l'emporte sur l'intention : la maintenance ne se lit qu'une fois le
  // node joignable, sans quoi une panne serait maquillée en intervention.
  return node.maintenance ? "maintenance" : "operational";
}

/** Fenêtre de la disponibilité publiée. */
export const UPTIME_WINDOW_DAYS = 90;

/** En deçà, la période observée est trop courte pour qu'un pourcentage dise quelque chose. */
export const UPTIME_MIN_OBSERVED_MS = 60 * 60_000;

export interface OutageSpan {
  startedAt: string;
  /** `null` : la panne dure encore. */
  endedAt: string | null;
}

/**
 * Part du temps où le composant était joignable entre `from` et `to`, de 0 à 1.
 *
 * Les pannes sont coupées à la fenêtre, et leurs chevauchements ne comptent
 * qu'une fois. Rend `null` quand la fenêtre est trop courte : une heure
 * d'observation ne fonde pas un « 100 % ».
 */
export function uptimeRatio(outages: readonly OutageSpan[], from: Date, to: Date): number | null {
  const start = from.getTime();
  const end = to.getTime();
  if (end - start < UPTIME_MIN_OBSERVED_MS) return null;

  const spans = outages
    .map((outage) => [
      Math.max(start, new Date(outage.startedAt).getTime()),
      Math.min(end, outage.endedAt === null ? end : new Date(outage.endedAt).getTime()),
    ])
    .filter(([a, b]) => (b as number) > (a as number))
    .sort((x, y) => (x[0] as number) - (y[0] as number)) as [number, number][];

  let down = 0;
  let cursor = start;
  for (const [a, b] of spans) {
    const from_ = Math.max(a, cursor);
    if (b > from_) {
      down += b - from_;
      cursor = b;
    }
  }
  return 1 - down / (end - start);
}

/** Début de la fenêtre publiée : 90 jours, ou moins si la consignation est plus récente. */
export function uptimeWindowStart(trackedSince: string, now: Date): Date {
  const window = now.getTime() - UPTIME_WINDOW_DAYS * 86_400_000;
  return new Date(Math.max(window, new Date(trackedSince).getTime()));
}
