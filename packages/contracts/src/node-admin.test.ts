import { describe, expect, it } from "vitest";
import {
  bindingChanges,
  bindingProblem,
  capacityRefusals,
  NodeBindingInput,
  NodeSettingsInput,
  nodeCapacityMb,
} from "./node-admin";

const binding = {
  fqdn: "node1.exemple.fr",
  scheme: "https",
  daemonPort: 8080,
  daemonSftpPort: 2022,
} as const;

describe("capacité d'un node", () => {
  it("compte la surallocation comme le placement des serveurs", () => {
    // 64 Go à 50 % de surallocation : le placement accepte jusqu'à 96 Go. Une
    // garde qui calculerait autrement laisserait passer une baisse que le
    // placement jugerait ensuite déjà dépassée.
    expect(nodeCapacityMb(65_536, 50)).toBe(98_304);
    expect(nodeCapacityMb(65_536, 0)).toBe(65_536);
  });

  it("refuse une baisse sous ce qui est promis aux serveurs", () => {
    const refusals = capacityRefusals(
      { memoryMb: 8192, memoryOverallocate: 0, diskMb: 100_000, diskOverallocate: 0 },
      { memoryMb: 12_288, diskMb: 50_000 },
    );
    expect(refusals).toEqual([{ resource: "memory", capacityMb: 8192, allocatedMb: 12_288 }]);
  });

  it("nomme les deux ressources quand les deux manquent", () => {
    const refusals = capacityRefusals(
      { memoryMb: 1024, memoryOverallocate: 0, diskMb: 1024, diskOverallocate: 0 },
      { memoryMb: 2048, diskMb: 4096 },
    );
    expect(refusals.map((r) => r.resource)).toEqual(["memory", "disk"]);
  });

  it("accepte une baisse que la surallocation couvre", () => {
    // 8 Go à 100 % valent 16 Go : 12 Go promis tiennent.
    expect(
      capacityRefusals(
        { memoryMb: 8192, memoryOverallocate: 100, diskMb: 10_000, diskOverallocate: 0 },
        { memoryMb: 12_288, diskMb: 10_000 },
      ),
    ).toEqual([]);
  });

  it("accepte une capacité exactement égale à ce qui est promis", () => {
    expect(
      capacityRefusals(
        { memoryMb: 4096, memoryOverallocate: 0, diskMb: 4096, diskOverallocate: 0 },
        { memoryMb: 4096, diskMb: 4096 },
      ),
    ).toEqual([]);
  });

  it("refuse une surallocation négative ou une capacité nulle", () => {
    const base = {
      name: "N",
      locationId: "00000000-0000-4000-8000-000000000000",
      category: null,
      subcategory: null,
      memoryMb: 1024,
      memoryOverallocate: 0,
      diskMb: 1024,
      diskOverallocate: 0,
      cpuCores: 4,
      isPublic: true,
    };
    expect(NodeSettingsInput.safeParse(base).success).toBe(true);
    expect(NodeSettingsInput.safeParse({ ...base, memoryOverallocate: -1 }).success).toBe(false);
    expect(NodeSettingsInput.safeParse({ ...base, diskMb: 0 }).success).toBe(false);
  });
});

describe("liaison d'un node", () => {
  it("repère les seuls champs qui changent", () => {
    expect(bindingChanges(binding, { ...binding, daemonPort: 8443 })).toEqual(["daemonPort"]);
    expect(bindingChanges(binding, binding)).toEqual([]);
  });

  it("normalise le nom de domaine avant de comparer", () => {
    // Une majuscule tapée par mégarde ne doit pas passer pour un changement
    // d'adresse, et donc pour une reconfiguration du daemon.
    const parsed = NodeBindingInput.parse({ ...binding, fqdn: " Node1.Exemple.FR " });
    expect(bindingChanges(binding, parsed)).toEqual([]);
  });

  it("exige un nom de domaine en HTTPS", () => {
    expect(bindingProblem({ ...binding, fqdn: "10.0.0.5" })).toMatch(/nom de domaine/);
    expect(bindingProblem({ ...binding, scheme: "http", fqdn: "10.0.0.5" })).toBeNull();
  });

  it("refuse le même port pour le daemon et le SFTP", () => {
    expect(bindingProblem({ ...binding, daemonSftpPort: 8080 })).toMatch(/différents/);
  });
});
