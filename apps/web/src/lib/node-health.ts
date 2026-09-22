import { type NodeStatus, nodeStatus } from "@gamedashboard/contracts";

/**
 * État d'un node dont le heartbeat peut n'avoir jamais eu lieu.
 *
 * `nodeStatus` exige une date, parce qu'un node en service en a forcément une.
 * Un node fraîchement déclaré, lui, n'a encore jamais été joint — et c'est
 * exactement ce que « injoignable » décrit. Le repli sur l'époque Unix produit
 * cette conclusion sans qu'on ait à l'écrire deux fois, ni à inventer un
 * troisième état pour « pas encore vu ».
 *
 * Écrit ici plutôt que recopié dans chaque écran : la valeur de repli est un
 * détail d'implémentation, et le jour où `nodeStatus` acceptera `null`, il n'y
 * aura qu'un endroit à corriger.
 */
export function nodeStatusOf(node: {
  maintenance: boolean;
  lastHeartbeatAt: string | null;
}): NodeStatus {
  return nodeStatus({
    maintenance: node.maintenance,
    lastHeartbeatAt: node.lastHeartbeatAt ?? new Date(0).toISOString(),
  });
}
