import { describe, expect, it } from "vitest";
import {
  type ClassifiedNode,
  groupNodes,
  isSelectionCoherent,
  type NodeCategory,
  type NodeSubcategory,
  subcategoriesOf,
} from "./node-taxonomy";

const categories: NodeCategory[] = [
  { id: "game", name: "Serveurs de jeu" },
  { id: "internal", name: "Interne" },
];

const subcategories: NodeSubcategory[] = [
  { id: "game-fr", categoryId: "game", name: "France" },
  { id: "game-pl", categoryId: "game", name: "Pologne" },
  { id: "internal-build", categoryId: "internal", name: "Build" },
];

interface Node extends ClassifiedNode {
  name: string;
}

const node = (name: string, categoryId: string, subcategoryId: string): Node => ({
  name,
  categoryId,
  subcategoryId,
});

const nodes: Node[] = [
  node("B", "internal", "internal-build"),
  node("A2", "game", "game-pl"),
  node("A1", "game", "game-fr"),
];

describe("groupNodes", () => {
  it("renvoie un groupe unique quand le regroupement est désactivé", () => {
    const groups = groupNodes(nodes, { categories, subcategories, groupBy: "none" });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.nodes).toHaveLength(3);
  });

  it("regroupe par catégorie dans l'ordre déclaré, pas d'arrivée", () => {
    const groups = groupNodes(nodes, { categories, subcategories, groupBy: "category" });
    expect(groups.map((g) => g.label)).toEqual(["Serveurs de jeu", "Interne"]);
    expect(groups[0]?.nodes).toHaveLength(2);
  });

  it("regroupe par sous-catégorie et rappelle la catégorie parente", () => {
    const groups = groupNodes(nodes, { categories, subcategories, groupBy: "subcategory" });
    expect(groups.map((g) => g.label)).toEqual(["France", "Pologne", "Build"]);
    expect(groups[0]?.parentLabel).toBe("Serveurs de jeu");
  });

  it("range un node à la catégorie inconnue sans le perdre", () => {
    const orphan = node("X", "supprimée", "aussi-supprimée");
    const groups = groupNodes([...nodes, orphan], {
      categories,
      subcategories,
      groupBy: "category",
    });
    const total = groups.reduce((sum, g) => sum + g.nodes.length, 0);
    expect(total).toBe(4);
    expect(groups.at(-1)?.label).toBe("Non classé");
  });

  it("ne crée aucun groupe pour une liste vide", () => {
    expect(groupNodes([], { categories, subcategories, groupBy: "category" })).toEqual([]);
  });
});

describe("subcategoriesOf", () => {
  it("ne renvoie que les sous-catégories de la catégorie demandée", () => {
    expect(subcategoriesOf(subcategories, "game").map((s) => s.id)).toEqual(["game-fr", "game-pl"]);
  });

  it("renvoie tout pour « toutes catégories »", () => {
    expect(subcategoriesOf(subcategories, "all")).toHaveLength(3);
  });
});

describe("isSelectionCoherent", () => {
  it("accepte une sous-catégorie appartenant à la catégorie", () => {
    expect(isSelectionCoherent(subcategories, "game", "game-fr")).toBe(true);
  });

  it("refuse une sous-catégorie d'une autre catégorie", () => {
    // Sans cette vérification, changer de catégorie laisserait un filtre
    // impossible à satisfaire et le tableau paraîtrait vide sans raison.
    expect(isSelectionCoherent(subcategories, "game", "internal-build")).toBe(false);
  });

  it("considère « toutes » comme toujours cohérent", () => {
    expect(isSelectionCoherent(subcategories, "all", "internal-build")).toBe(true);
    expect(isSelectionCoherent(subcategories, "game", "all")).toBe(true);
  });
});
