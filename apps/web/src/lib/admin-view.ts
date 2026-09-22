import type { AdminNode } from "@/server/api/admin";

/** Node tel que l'attend `AdminNodes`, indépendant de la source des données. */
export interface NodeRow {
  id: string;
  name: string;
  categoryId: string;
  subcategoryId: string;
  location: string;
  fqdn: string;
  maintenance: boolean;
  version: string;
  servers: number;
  memoryTotalMb: number;
  diskTotalMb: number;
  /**
   * Ce qui est accordé aux serveurs de la machine — exact, toujours.
   *
   * Ne dépend d'aucun relevé : c'est la somme de ce que le panel a promis.
   * Zéro sur un node vide est donc une vérité, pas une mesure manquante.
   */
  allocatedMemoryMb: number;
  allocatedDiskMb: number;
  /**
   * Ce qui est réellement consommé, `null` faute de relevé récent.
   *
   * Jamais ramené à zéro : « rien ne consomme » et « on n'a rien mesuré » sont
   * deux affirmations différentes, et la seconde ne doit pas se lire comme la
   * première.
   */
  measuredMemoryMb: number | null;
  measuredDiskMb: number | null;
  measuredServers: number;
  lastHeartbeatAt: string;
  /** Revendeur exploitant. `null` vaut « la plateforme », pas « personne ». */
  ownerId: string | null;
  ownerName: string | null;
}

/**
 * Traduit un node de l'API en ligne affichable.
 *
 * Deux chiffres de capacité, et il faut les deux.
 *
 * L'**allocation** est exacte et vient de notre propre base : elle dit ce que
 * la machine a déjà promis, donc s'il reste de la place pour un serveur de
 * plus. La **consommation** vient des relevés du collecteur et peut manquer ;
 * elle dit ce qui est réellement employé de ce qu'on a vendu.
 *
 * Wings n'offre aucune route donnant la charge d'une machine — son
 * `/api/system` ne rend que l'architecture, le noyau et la version. La
 * consommation d'un node ne peut donc qu'être l'addition de celle de ses
 * serveurs, et elle vaut `null` tant qu'aucun n'a été relevé.
 *
 * Une date de heartbeat absente est ramenée à l'époque Unix : `nodeStatus()`
 * conclut alors « injoignable », qui est la lecture correcte d'un node qui n'a
 * jamais donné signe de vie.
 *
 * L'exploitant est **facultatif** en entrée : la page de statut publique sert
 * un node sans lui, et c'est voulu — savoir quel revendeur exploite quelle
 * machine est un renseignement d'administration, pas une information de
 * disponibilité. Son absence vaut « la plateforme » à l'affichage.
 */
export function toNodeRow(
  node: Omit<AdminNode, "ownerId" | "ownerName"> &
    Partial<Pick<AdminNode, "ownerId" | "ownerName">>,
): NodeRow {
  return {
    id: node.id,
    name: node.name,
    ownerId: node.ownerId ?? null,
    ownerName: node.ownerName ?? null,
    categoryId: node.category ?? "",
    subcategoryId: node.subcategory ?? "",
    location: node.location,
    fqdn: node.fqdn,
    maintenance: node.maintenance,
    version: node.wingsVersion ?? "inconnue",
    servers: node.servers,
    memoryTotalMb: node.memoryMb,
    diskTotalMb: node.diskMb,
    allocatedMemoryMb: node.allocatedMemoryMb,
    allocatedDiskMb: node.allocatedDiskMb,
    measuredMemoryMb: node.measuredMemoryMb,
    measuredDiskMb: node.measuredDiskMb,
    measuredServers: node.measuredServers,
    lastHeartbeatAt: node.lastHeartbeatAt ?? new Date(0).toISOString(),
  };
}
