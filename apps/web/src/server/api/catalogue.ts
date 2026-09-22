"use server";

import type { ProvisioningMode, ResourceRequest } from "@gamedashboard/contracts";
import { apiFetch, apiSendFor } from "./client";
import type { ResellerQuotaReport } from "./reseller";

export interface CatalogueVariable {
  envVariable: string;
  name: string;
  description: string | null;
  defaultValue: string;
  isEditable: boolean;
}

export interface CatalogueGame {
  eggId: string;
  name: string;
  nest: string;
  description: string | null;
  minMemoryMb: number;
  variables: CatalogueVariable[];
}

export interface CataloguePlan {
  id: string;
  name: string;
  memoryMb: number;
  diskMb: number;
  cpuPct: number;
  swapMb: number;
  backups: number;
  databases: number;
  allocations: number;
  priceLabel: string;
}

export interface CatalogueLocation {
  id: string;
  short: string;
  long: string;
  countryCode: string;
  availablePorts: number;
  isAvailable: boolean;
}

/**
 * Node proposé à qui a le droit de le désigner.
 *
 * La capacité est celle qui **reste**, sur-allocation comprise : c'est la
 * seule qui permette de décider quoi que ce soit.
 */
export interface CatalogueNode {
  id: string;
  name: string;
  locationId: string;
  locationShort: string;
  ownerId: string | null;
  maintenanceMode: boolean;
  freeMemoryMb: number;
  freeDiskMb: number;
  cpuCores: number;
  freePorts: number;
}

export interface Catalogue {
  /** Décidé par l'API d'après le rôle. L'écran s'y conforme, il ne le choisit pas. */
  mode: ProvisioningMode;
  games: CatalogueGame[];
  plans: CataloguePlan[];
  locations: CatalogueLocation[];
  /** Vide en mode guidé : le panel choisit le node, le client ne le désigne pas. */
  nodes: CatalogueNode[];
  /**
   * Enveloppe du revendeur, `null` pour les autres rôles.
   *
   * `null` et non une enveloppe illimitée : la notion ne s'applique pas hors
   * du mode assisté, et un objet ferait afficher un plafond qui n'existe pas.
   */
  quota: ResellerQuotaReport | null;
}

export async function fetchCreationCatalogue(): Promise<Catalogue> {
  const { data } = await apiFetch<{ data: Catalogue }>("/api/v1/client/catalogue");
  return data;
}

/**
 * Demande de création.
 *
 * Les champs des modes avancés sont facultatifs : l'API retient ce que le rôle
 * autorise, et rien de plus. Les envoyer depuis un écran guidé ne donnerait
 * rien — c'est voulu.
 */
export interface CreateServerInput {
  eggId: string;
  name: string;
  variables: Record<string, string>;
  planId?: string;
  locationId?: string;
  nodeId?: string;
  ownerId?: string;
  resources?: ResourceRequest;
}

export async function createServer(
  input: CreateServerInput,
): Promise<{ id: string | null; error: string | null }> {
  try {
    const { data } = await apiSendFor<{ data: { id: string } }>("/api/v1/client/servers", input);
    return { id: data.id, error: null };
  } catch (error) {
    return { id: null, error: error instanceof Error ? error.message : "Création refusée." };
  }
}
