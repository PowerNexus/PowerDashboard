/**
 * Lecture d'une page Instatus.
 *
 * Instatus publie, sur toute page publique, un `summary.json` qui ne demande
 * aucune clé. C'est lui qu'on lit, et non l'API authentifiée : ce qu'on veut
 * afficher aux clients est exactement ce qui est déjà public, et une
 * intégration qui cesse de fonctionner le jour où une clé expire vaut moins
 * qu'une intégration qui ne demande rien.
 *
 * Ce module ne fait que traduire. Il ne connaît ni le réseau ni les réglages :
 * ce qui décide de ce qu'on affiche doit pouvoir être éprouvé sans eux.
 */

/**
 * États rendus par Instatus, ramenés aux nôtres.
 *
 * `UNDERMAINTENANCE` est distinct de `HASISSUES` et doit le rester : une
 * maintenance annoncée est une décision, une panne est un accident. Les
 * confondre ferait dire au panel « incident en cours » pendant des travaux
 * planifiés — et le client qui appelle le support a raison de le faire.
 */
export type InstatusState = "operational" | "maintenance" | "incident" | "unknown";

export interface InstatusEntry {
  id: string;
  name: string;
  /** Début déclaré, en ISO. Nul quand Instatus ne le donne pas. */
  startedAt: string | null;
  /** Lien vers le détail sur la page publique, quand il existe. */
  url: string | null;
}

export interface InstatusSummary {
  pageName: string | null;
  pageUrl: string | null;
  state: InstatusState;
  incidents: InstatusEntry[];
  maintenances: InstatusEntry[];
}

/** Rien à dire : ni page configurée, ni page joignable. */
export const INSTATUS_SILENT: InstatusSummary = {
  pageName: null,
  pageUrl: null,
  state: "unknown",
  incidents: [],
  maintenances: [],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Les listes sont **absentes** quand elles sont vides.
 *
 * Instatus n'émet `activeIncidents` et `activeMaintenances` que s'il y a
 * quelque chose dedans. Un code qui les attend toujours lirait `undefined` et
 * planterait précisément le jour où tout va bien.
 */
function readEntries(raw: unknown): InstatusEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((item): InstatusEntry[] => {
    const entry = asRecord(item);
    if (!entry) return [];

    const name = asString(entry.name);
    if (!name) return [];

    return [
      {
        id: asString(entry.id) ?? name,
        name,
        // `started` pour un incident, `start` pour une maintenance : Instatus
        // ne nomme pas les deux pareil.
        startedAt: asString(entry.started) ?? asString(entry.start),
        url: asString(entry.url),
      },
    ];
  });
}

/**
 * Traduit un `summary.json`.
 *
 * Ne lève jamais : une page de statut injoignable ou refaite ne doit pas
 * empêcher le panel de s'afficher. L'absence d'information se dit `unknown`,
 * ce qui n'affiche rien — et non `operational`, qui affirmerait que tout va
 * bien sans l'avoir vérifié.
 */
export function parseInstatusSummary(raw: unknown): InstatusSummary {
  const root = asRecord(raw);
  if (!root) return INSTATUS_SILENT;

  const page = asRecord(root.page);
  const incidents = readEntries(root.activeIncidents);
  const maintenances = readEntries(root.activeMaintenances);

  return {
    pageName: asString(page?.name),
    pageUrl: asString(page?.url),
    state: readState(asString(page?.status), incidents, maintenances),
    incidents,
    maintenances,
  };
}

/**
 * L'état déclaré, recoupé avec ce qui est listé.
 *
 * Le champ `status` fait autorité quand il est reconnaissable. Sinon, la
 * présence d'un incident ou d'une maintenance tranche — une page qui liste un
 * incident ouvert dit déjà l'essentiel, même si son `status` a changé de nom
 * dans une version d'Instatus que nous ne connaissons pas.
 */
function readState(
  declared: string | null,
  incidents: InstatusEntry[],
  maintenances: InstatusEntry[],
): InstatusState {
  switch (declared?.toUpperCase()) {
    case "UP":
      return "operational";
    case "UNDERMAINTENANCE":
      return "maintenance";
    case "HASISSUES":
      return "incident";
    default:
      break;
  }

  if (incidents.length > 0) return "incident";
  if (maintenances.length > 0) return "maintenance";
  return "unknown";
}

/**
 * Compose l'adresse du résumé à partir de celle de la page.
 *
 * Rend `null` pour toute adresse qui n'est pas une URL http(s) : la valeur
 * vient d'un champ de formulaire, et une adresse en `file:` ou une adresse
 * interne feraient de ce réglage un moyen de faire émettre au serveur des
 * requêtes qu'on choisit à sa place.
 */
export function instatusSummaryUrl(pageUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  parsed.pathname = "/summary.json";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}
