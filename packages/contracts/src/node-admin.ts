import { z } from "zod";

/**
 * Modification d'un node existant, et retrait de ports de son stock.
 *
 * Deux familles de champs, et elles ne suivent pas le même chemin :
 *
 * - **les réglages** (nom, localisation, classement, capacité, visibilité) ne
 *   concernent que le panel. Ils s'écrivent en base directement ; seule la
 *   capacité a une garde — on ne descend pas sous ce qui est déjà promis ;
 * - **la liaison** (nom de domaine, protocole, port du daemon, port SFTP) vit
 *   *aussi* dans le `config.yml` de la machine. La changer en base sans que
 *   Wings le sache coupe le panel de son daemon. Elle passe donc par
 *   `NodeConfigurationService.rebind`, qui n'enregistre que ce que le daemon a
 *   prouvé savoir. Voir `docs/runbooks/modifier-liaison-node.md`.
 *
 * Les règles vivent ici, et non dans l'écran ou le service seuls : l'écran les
 * applique pour prévenir, l'API pour refuser, et deux copies finiraient par
 * diverger.
 */

/** Pourcentage de surallocation : 0 = pas de dépassement, 100 = le double. */
const Overallocate = z.number().int().min(0).max(1000);

/** Ce qu'on règle sans toucher au daemon. */
export const NodeSettingsInput = z.object({
  name: z.string().trim().min(1).max(100),
  locationId: z.string().uuid(),
  category: z.string().max(60).nullable(),
  subcategory: z.string().max(60).nullable(),
  memoryMb: z.number().int().positive(),
  memoryOverallocate: Overallocate,
  diskMb: z.number().int().positive(),
  diskOverallocate: Overallocate,
  cpuCores: z.number().positive().max(1024),
  isPublic: z.boolean(),
});
export type NodeSettingsInput = z.infer<typeof NodeSettingsInput>;

const Port = z.number().int().min(1).max(65_535);

/** Ce qui vit aussi dans le `config.yml` de la machine. */
export const NodeBindingInput = z.object({
  fqdn: z.string().trim().toLowerCase().min(1).max(255),
  scheme: z.enum(["http", "https"]),
  daemonPort: Port,
  daemonSftpPort: Port,
});
export type NodeBindingInput = z.infer<typeof NodeBindingInput>;

/** Les champs de liaison, dans l'ordre où l'écran les présente. */
export const NODE_BINDING_FIELDS = ["fqdn", "scheme", "daemonPort", "daemonSftpPort"] as const;
export type NodeBindingField = (typeof NODE_BINDING_FIELDS)[number];

/** Les champs de liaison qui diffèrent entre l'état enregistré et la demande. */
export function bindingChanges(
  current: Record<NodeBindingField, string | number>,
  next: NodeBindingInput,
): NodeBindingField[] {
  return NODE_BINDING_FIELDS.filter((field) => current[field] !== next[field]);
}

/** Ce qui rend une liaison inacceptable, sous forme de code : l'écran traduit. */
export type BindingProblemCode = "fqdn_needs_domain" | "ports_collide";

/**
 * Un nom de domaine est exigé en HTTPS : une adresse IP ne porte pas de
 * certificat valide, et le daemon paraîtrait injoignable sans raison visible.
 * Même règle qu'à la création (`InfrastructureService.createNode`).
 */
export function bindingProblemCode(binding: NodeBindingInput): BindingProblemCode | null {
  if (binding.scheme === "https" && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(binding.fqdn)) {
    return "fqdn_needs_domain";
  }
  if (binding.daemonPort === binding.daemonSftpPort) return "ports_collide";
  return null;
}

/** Le même refus, en phrase, pour l'API. */
export function bindingProblem(binding: NodeBindingInput): string | null {
  switch (bindingProblemCode(binding)) {
    case "fqdn_needs_domain":
      return "Un nom de domaine est attendu en HTTPS : une adresse IP ne peut pas porter de certificat valide.";
    case "ports_collide":
      return "Le port du daemon et le port SFTP doivent être différents : un seul programme peut écouter sur un port.";
    default:
      return null;
  }
}

/**
 * Capacité réellement offerte, surallocation comprise.
 *
 * La formule est celle du placement des serveurs (`CatalogueService`) : une
 * garde qui calculerait autrement laisserait passer une baisse que le
 * placement jugerait ensuite déjà dépassée.
 */
export function nodeCapacityMb(totalMb: number, overallocatePct: number): number {
  return Math.floor(totalMb * (1 + overallocatePct / 100));
}

export interface CapacityRefusal {
  resource: "memory" | "disk";
  /** Capacité demandée, surallocation comprise. */
  capacityMb: number;
  /** Déjà accordé aux serveurs de la machine. */
  allocatedMb: number;
}

/**
 * Ce qu'une nouvelle capacité ne couvrirait plus.
 *
 * On compare à ce qui est **accordé** aux serveurs, pas à ce qu'ils consomment :
 * une limite vendue est une promesse, et la machine doit pouvoir la tenir même
 * si le client ne s'en sert pas aujourd'hui. Vide quand la baisse est tenable.
 */
export function capacityRefusals(
  next: Pick<NodeSettingsInput, "memoryMb" | "memoryOverallocate" | "diskMb" | "diskOverallocate">,
  allocated: { memoryMb: number; diskMb: number },
): CapacityRefusal[] {
  const refusals: CapacityRefusal[] = [];
  const memory = nodeCapacityMb(next.memoryMb, next.memoryOverallocate);
  if (memory < allocated.memoryMb) {
    refusals.push({ resource: "memory", capacityMb: memory, allocatedMb: allocated.memoryMb });
  }
  const disk = nodeCapacityMb(next.diskMb, next.diskOverallocate);
  if (disk < allocated.diskMb) {
    refusals.push({ resource: "disk", capacityMb: disk, allocatedMb: allocated.diskMb });
  }
  return refusals;
}

/** Retrait de ports : une liste d'identifiants, bornée comme l'ajout. */
export const AllocationRemovalInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(5000),
});
export type AllocationRemovalInput = z.infer<typeof AllocationRemovalInput>;
