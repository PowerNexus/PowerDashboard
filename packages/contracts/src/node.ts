import { z } from "zod";

/**
 * Santé d'un node, dérivée du heartbeat du daemon Wings.
 *
 * Le daemon émet un heartbeat à intervalle fixe. L'état du node n'est donc pas
 * un champ que l'on stocke et met à jour, mais une conclusion tirée de l'âge du
 * dernier heartbeat : un booléen « en ligne » stocké à part finirait tôt ou tard
 * par contredire l'horodatage.
 */
export const NODE_HEARTBEAT_INTERVAL_MS = 10_000;
/**
 * Au-delà, un heartbeat manque : le node est joignable mais en retard.
 *
 * **Trois fois la cadence de la sonde, et non une fois et demie.** Le seuil a
 * d'abord été posé à trente secondes, soit dix de plus que le pire cas d'un
 * tour de sonde : il suffisait d'un tour ralenti — une requête lente, un
 * redémarrage de l'API — pour que l'écran annonce « heartbeat en retard » à
 * côté d'un « il y a 30 secondes », ce qui se lit comme une contradiction et
 * fait douter des deux. Une minute laisse passer deux tours manqués avant de
 * s'en inquiéter, et reste très en deçà des deux minutes qui font conclure à
 * l'injoignabilité.
 */
export const NODE_HEARTBEAT_STALE_MS = 60_000;
/** Au-delà, on considère le daemon injoignable et ses mesures périmées. */
export const NODE_HEARTBEAT_LOST_MS = 120_000;

export const NodeStatus = z.enum(["online", "stale", "maintenance", "unreachable"]);
export type NodeStatus = z.infer<typeof NodeStatus>;

/** Mesures instantanées : absentes tant qu'aucun heartbeat récent ne les a portées. */
export const NodeLiveMetrics = z.object({
  cpuPct: z.number().min(0),
  memoryUsedMb: z.number().int().nonnegative(),
  diskUsedMb: z.number().int().nonnegative(),
});
export type NodeLiveMetrics = z.infer<typeof NodeLiveMetrics>;

export const NodeHealthInput = z.object({
  lastHeartbeatAt: z.string().datetime(),
  maintenance: z.boolean(),
});
export type NodeHealthInput = z.infer<typeof NodeHealthInput>;

/**
 * Un node injoignable l'est quoi qu'il arrive : la maintenance est une intention
 * déclarée par l'administrateur, l'absence de heartbeat est un fait observé.
 * Le fait l'emporte.
 */
export function nodeStatus(node: NodeHealthInput, now: number = Date.now()): NodeStatus {
  const age = now - new Date(node.lastHeartbeatAt).getTime();
  if (age > NODE_HEARTBEAT_LOST_MS) return "unreachable";
  if (node.maintenance) return "maintenance";
  if (age > NODE_HEARTBEAT_STALE_MS) return "stale";
  return "online";
}

/** Les mesures ne sont exploitables que si le daemon répond encore. */
export function hasLiveMetrics(status: NodeStatus): boolean {
  return status !== "unreachable";
}

export const NODE_STATUS_LABEL: Record<NodeStatus, string> = {
  online: "Opérationnel",
  stale: "Heartbeat en retard",
  maintenance: "Maintenance",
  unreachable: "Injoignable",
};

export const NODE_STATUS_TONE: Record<NodeStatus, "success" | "warning" | "danger"> = {
  online: "success",
  stale: "warning",
  maintenance: "warning",
  unreachable: "danger",
};
