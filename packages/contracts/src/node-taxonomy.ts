import { z } from "zod";

/**
 * Classement des nodes sur deux niveaux. Au-delà d'une trentaine de machines,
 * une liste plate devient illisible : il faut pouvoir replier ce qu'on ne
 * regarde pas et compter ce qui reste.
 */
export const NodeCategory = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
});
export type NodeCategory = z.infer<typeof NodeCategory>;

export const NodeSubcategory = z.object({
  id: z.string(),
  categoryId: z.string(),
  name: z.string(),
});
export type NodeSubcategory = z.infer<typeof NodeSubcategory>;

/** Ce qu'un node doit porter pour être classé et trié. */
export interface ClassifiedNode {
  categoryId: string;
  subcategoryId: string;
}

export const NodeGroupBy = z.enum(["none", "category", "subcategory"]);
export type NodeGroupBy = z.infer<typeof NodeGroupBy>;

export interface NodeGroup<T> {
  key: string;
  label: string;
  /** Intitulé de rattachement, affiché en second quand on groupe finement. */
  parentLabel?: string;
  nodes: T[];
}

/**
 * Ce que le regroupement demande vraiment d'une catégorie.
 *
 * Un identifiant et un intitulé — rien d'autre n'est lu. Exiger le type complet
 * obligerait chaque appelant à fournir une description dont cette fonction ne
 * fait rien, et ferait échouer la compilation sur un `null` venu de la base là
 * où le schéma déclare `string | undefined`. Le contrat porte sur l'usage, pas
 * sur la provenance.
 */
export interface GroupableCategory {
  id: string;
  name: string;
}

export interface GroupableSubcategory extends GroupableCategory {
  categoryId: string;
}

export interface GroupNodesOptions {
  categories: readonly GroupableCategory[];
  subcategories: readonly GroupableSubcategory[];
  groupBy: NodeGroupBy;
}

const UNCLASSIFIED = "Non classé";

/**
 * Répartit les nodes en groupes. L'ordre des catégories déclarées est conservé,
 * de sorte que le tableau reste stable d'un chargement à l'autre. Un node dont
 * la catégorie n'existe pas est rangé dans « Non classé » plutôt que perdu.
 */
export function groupNodes<T extends ClassifiedNode>(
  nodes: readonly T[],
  { categories, subcategories, groupBy }: GroupNodesOptions,
): NodeGroup<T>[] {
  if (groupBy === "none") {
    return [{ key: "all", label: "Tous les nodes", nodes: [...nodes] }];
  }

  const groups: NodeGroup<T>[] = [];
  const push = (key: string, label: string, node: T, parentLabel?: string) => {
    const existing = groups.find((g) => g.key === key);
    if (existing) existing.nodes.push(node);
    else groups.push({ key, label, parentLabel, nodes: [node] });
  };

  const ordered = [...nodes].sort((a, b) => {
    const ca = categories.findIndex((c) => c.id === a.categoryId);
    const cb = categories.findIndex((c) => c.id === b.categoryId);
    if (ca !== cb)
      return (
        (ca === -1 ? Number.MAX_SAFE_INTEGER : ca) - (cb === -1 ? Number.MAX_SAFE_INTEGER : cb)
      );
    const sa = subcategories.findIndex((s) => s.id === a.subcategoryId);
    const sb = subcategories.findIndex((s) => s.id === b.subcategoryId);
    return (sa === -1 ? Number.MAX_SAFE_INTEGER : sa) - (sb === -1 ? Number.MAX_SAFE_INTEGER : sb);
  });

  for (const node of ordered) {
    const category = categories.find((c) => c.id === node.categoryId);
    if (groupBy === "category") {
      push(node.categoryId || "unclassified", category?.name ?? UNCLASSIFIED, node);
    } else {
      const sub = subcategories.find((s) => s.id === node.subcategoryId);
      push(
        node.subcategoryId || "unclassified",
        sub?.name ?? UNCLASSIFIED,
        node,
        category?.name ?? UNCLASSIFIED,
      );
    }
  }

  return groups;
}

/** Sous-catégories rattachées à une catégorie, dans l'ordre déclaré. */
export function subcategoriesOf<T extends GroupableSubcategory>(
  subcategories: readonly T[],
  categoryId: string | "all",
): T[] {
  if (categoryId === "all") return [...subcategories];
  return subcategories.filter((s) => s.categoryId === categoryId);
}

/**
 * Vrai si la sous-catégorie choisie appartient encore à la catégorie choisie.
 * Sert à invalider un filtre devenu incohérent quand on change de catégorie.
 */
export function isSelectionCoherent(
  subcategories: readonly GroupableSubcategory[],
  categoryId: string | "all",
  subcategoryId: string | "all",
): boolean {
  if (subcategoryId === "all" || categoryId === "all") return true;
  return subcategories.some((s) => s.id === subcategoryId && s.categoryId === categoryId);
}
