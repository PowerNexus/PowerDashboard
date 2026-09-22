import "server-only";
import {
  HOSTBILL_SILENT,
  type HostbillSummary,
  INSTATUS_SILENT,
  type InstatusSummary,
} from "@gamedashboard/contracts";
import { apiFetch } from "./client";
import { forwardedIdentityHeaders } from "./forwarded";

/**
 * Lectures des deux systèmes tiers : la facturation et la page de statut.
 *
 * Aucune des deux ne lève. Ni HostBill ni Instatus ne sont sous notre
 * responsabilité, et une page du panel qui disparaît parce qu'un service
 * extérieur tarde est une panne que nous nous serions infligée. L'absence
 * d'information s'affiche comme telle ; elle n'interrompt rien.
 */

/** Services facturés du client connecté. Silencieux si HostBill n'est pas réglé. */
export async function fetchBilling(): Promise<HostbillSummary> {
  try {
    const { data } = await apiFetch<{ data: HostbillSummary }>("/api/v1/client/billing");
    return data;
  } catch {
    /*
     * Le silence, plutôt que l'erreur.
     *
     * `apiFetch` redirige vers la connexion sur un 401 — ce cas-là continue de
     * passer, puisque `redirect()` lève une exception que Next intercepte
     * lui-même. Ce qu'on avale ici, c'est l'API muette ou lente : la page
     * d'accueil doit montrer les serveurs même quand la facturation est
     * injoignable.
     */
    return HOSTBILL_SILENT;
  }
}

/**
 * Ce que la page Instatus annonce.
 *
 * N'utilise **pas** `apiFetch` : celui-ci renvoie vers la connexion sur un
 * refus, ce qui transformerait une bannière absente en redirection. La
 * bannière doit aussi pouvoir s'afficher sur l'écran de connexion — c'est même
 * là qu'elle sert le plus, quand le panel est en travaux.
 */
export async function fetchNotice(): Promise<InstatusSummary> {
  const base = process.env.API_URL ?? "http://127.0.0.1:3201";

  try {
    const response = await fetch(`${base}/api/v1/status/notice`, {
      headers: await forwardedIdentityHeaders(),
      // Trois secondes : au-delà, une annonce de maintenance ne vaut pas de
      // retarder l'affichage de la page qu'on est venu chercher.
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
    if (!response.ok) return INSTATUS_SILENT;
    const { data } = (await response.json()) as { data: InstatusSummary };
    return data;
  } catch {
    return INSTATUS_SILENT;
  }
}
