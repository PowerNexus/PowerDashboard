import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { UpdateStep } from "@gamedashboard/contracts";
import type { PublishedRelease } from "./github-releases";

/**
 * `etat.json`, à la racine d'un hébergement autonome : ce qui tourne, ce qui
 * tournait avant, ce qui a été mis de côté, et où en est la mise à jour.
 *
 * Deux écrivains le partagent : ce module, et le lanceur de Passenger
 * (`infra/cpanel/lanceur.cjs`), qui y lit la version à démarrer et y revient
 * de lui-même à la précédente quand une nouvelle ne confirme pas son
 * démarrage. D'où des clés en français, celles du lanceur, et des écritures
 * atomiques des deux côtés.
 */
export interface UpdateState {
  /** Version démarrée par le lanceur (`vX.Y.Z`). */
  enService?: string;
  /** Celle vers laquelle revenir. */
  precedente?: string | null;
  /** Bascule en attente de confirmation par la nouvelle version. */
  bascule?: {
    version: string;
    depuis: string;
    /** Démarrages de l'API comptés par le lanceur. */
    demarrages?: number;
    confirmee: boolean;
  } | null;
  /** Versions mises de côté après un échec : jamais retentées. */
  refusees?: string[];
  derniereVerification?: string | null;
  /** Dernière release publiée, vue à la dernière vérification. */
  derniereRelease?: PublishedRelease | null;
  /**
   * Étiquette HTTP de la dernière réponse de GitHub : une release inchangée
   * se relit de `derniereRelease` sans rien coûter à la limite anonyme.
   */
  etagRelease?: string | null;
  /** Mise à jour en cours. */
  operation?: { etape: UpdateStep; version: string; depuis: string } | null;
  dernierResultat?: {
    etat: "installee" | "refusee" | "erreur";
    version: string;
    message?: string;
    date: string;
  } | null;
}

const FICHIER = "etat.json";

export function readState(root: string): UpdateState {
  try {
    return JSON.parse(readFileSync(join(root, FICHIER), "utf8")) as UpdateState;
  } catch {
    return {};
  }
}

/** Écriture atomique : un fichier à moitié écrit ne se lit jamais. */
export function writeState(root: string, state: UpdateState): void {
  const fichier = join(root, FICHIER);
  const provisoire = `${fichier}.${process.pid}.tmp`;
  writeFileSync(provisoire, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(provisoire, fichier);
}

/** Lit, modifie, réécrit. Renvoie l'état écrit. */
export function updateState(root: string, change: (state: UpdateState) => void): UpdateState {
  const state = readState(root);
  change(state);
  writeState(root, state);
  return state;
}

/**
 * Demande à Passenger de relancer les deux applications à leur prochaine
 * requête : c'est `tmp/restart.txt`, dans chaque racine d'application, qui
 * le lui dit.
 */
export function requestRestart(root: string): void {
  for (const role of ["api", "interface"]) {
    const dossier = join(root, "passenger", role, "tmp");
    mkdirSync(dossier, { recursive: true });
    writeFileSync(join(dossier, "restart.txt"), `${Date.now()}\n`);
  }
}

/** Ordre des versions sémantiques ; une préversion passe avant sa version. */
export function compareReleaseVersions(a: string, b: string): number {
  const cut = (v: string) => {
    const [base = "", pre] = v.replace(/^v/, "").split("-", 2);
    return { numbers: base.split(".").map(Number), pre: pre ?? null };
  };
  const x = cut(a);
  const y = cut(b);
  for (let i = 0; i < 3; i++) {
    const diff = (x.numbers[i] ?? 0) - (y.numbers[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

export const VERSION_PATTERN = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
