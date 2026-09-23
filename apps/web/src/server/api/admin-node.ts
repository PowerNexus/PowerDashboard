import { notFound } from "next/navigation";
import { ApiError, apiFetch } from "./client";

/**
 * Lectures de la fiche d'un node.
 *
 * Fichier à part d'`admin.ts` : la fiche est un écran à elle seule, et ses
 * formes n'intéressent qu'elle.
 */

/** Ce que la fiche présente d'un node. Le jeton n'en fait jamais partie. */
export interface AdminNodeDetail {
  id: string;
  name: string;
  locationId: string;
  category: string | null;
  subcategory: string | null;
  fqdn: string;
  scheme: "http" | "https";
  daemonPort: number;
  daemonSftpPort: number;
  memoryMb: number;
  memoryOverallocate: number;
  diskMb: number;
  diskOverallocate: number;
  cpuCores: number;
  isPublic: boolean;
  maintenance: boolean;
  ownerId: string | null;
  wingsVersion: string | null;
  lastHeartbeatAt: string | null;
  unreachableSince: string | null;
  tokenId: string;
  tokenRotatedAt: string;
  createdAt: string;
  /** Promis aux serveurs de la machine : le plancher de toute baisse de capacité. */
  memoryAllocatedMb: number;
  diskAllocatedMb: number;
  servers: number;
}

/** Un port du stock, et le serveur qui l'occupe s'il y en a un. */
export interface AdminNodeAllocation {
  id: string;
  ip: string;
  ipAlias: string | null;
  port: number;
  notes: string | null;
  serverId: string | null;
  serverName: string | null;
  /** Port principal du serveur, celui sur lequel il écoute. */
  isPrimary: boolean;
}

const unwrap = async <T>(path: string): Promise<T> => {
  try {
    return (await apiFetch<{ data: T }>(path)).data;
  } catch (error) {
    // Même règle qu'`admin.ts` : 401, 403, 404 disent « pas pour vous ».
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) notFound();
    throw error;
  }
};

export const fetchAdminNodeDetail = (nodeId: string) =>
  unwrap<AdminNodeDetail>(`/api/v1/admin/nodes/${encodeURIComponent(nodeId)}`);

export const fetchNodeAllocations = (nodeId: string) =>
  unwrap<AdminNodeAllocation[]>(`/api/v1/admin/nodes/${encodeURIComponent(nodeId)}/allocations`);
