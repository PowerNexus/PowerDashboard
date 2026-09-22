import type { IncidentImpact, IncidentState, PlatformState } from "@gamedashboard/contracts";

/**
 * Lecture de la page de statut.
 *
 * Elle n'emprunte **pas** `apiFetch` : celui-ci transmet la session et renvoie
 * vers la connexion sur un refus. Or cette page est faite pour être lue par
 * quelqu'un qui ne peut pas se connecter, et la renvoyer vers /login serait lui
 * répondre par la panne qu'elle devait expliquer.
 *
 * Elle ne lève rien non plus. Une page de statut qui tombe en erreur parce que
 * l'API est tombée est une page de statut inutile : l'API muette **est** une
 * information, et c'est celle-là qu'il faut afficher.
 */
const API_URL = process.env.API_URL ?? "http://127.0.0.1:3201";

/** Court : le lecteur attend déjà que quelque chose se débloque. */
const TIMEOUT_MS = 5_000;

export interface StatusComponent {
  id: string;
  name: string;
  location: string;
  state: PlatformState;
}

export interface StatusIncidentUpdate {
  state: IncidentState;
  body: string;
  at: string;
}

export interface StatusIncident {
  id: string;
  title: string;
  state: IncidentState;
  impact: IncidentImpact;
  components: string[];
  updates: StatusIncidentUpdate[];
  startedAt: string;
  resolvedAt: string | null;
}

export interface StatusReport {
  state: PlatformState;
  components: StatusComponent[];
  openIncidents: StatusIncident[];
  recentIncidents: StatusIncident[];
  at: string;
  /**
   * L'API a-t-elle répondu ?
   *
   * Champ ajouté ici, absent de la réponse de l'API — par construction, elle ne
   * peut pas dire elle-même qu'elle est injoignable. C'est ce qui permet à la
   * page d'afficher une panne du panel au lieu d'un écran d'erreur.
   */
  reachable: boolean;
}

/** Ce qu'on affiche quand l'API elle-même ne répond pas. */
const UNREACHABLE: StatusReport = {
  state: "down",
  components: [],
  openIncidents: [],
  recentIncidents: [],
  at: new Date(0).toISOString(),
  reachable: false,
};

export async function fetchStatus(): Promise<StatusReport> {
  try {
    const response = await fetch(`${API_URL}/api/v1/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) return { ...UNREACHABLE, at: new Date().toISOString() };

    const { data } = (await response.json()) as { data: Omit<StatusReport, "reachable"> };
    return { ...data, reachable: true };
  } catch {
    return { ...UNREACHABLE, at: new Date().toISOString() };
  }
}
