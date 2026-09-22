import { describe, expect, it } from "vitest";
import { hasPermission, PERMISSION_GROUPS, ROLE_PRESETS, SERVER_PERMISSIONS } from "./permissions";

describe("hasPermission", () => {
  it("reconnaît une permission accordée", () => {
    expect(hasPermission(["console.read", "files.read"], "console.read")).toBe(true);
  });

  it("refuse une permission absente", () => {
    expect(hasPermission(["console.read"], "console.send")).toBe(false);
  });

  it("refuse tout sur une liste vide", () => {
    expect(hasPermission([], "console.read")).toBe(false);
  });
});

describe("ROLE_PRESETS", () => {
  it("donne au lecteur un accès strictement consultatif", () => {
    const writeLike = ROLE_PRESETS.viewer.filter((p) =>
      /\.(send|create|update|delete|write|reinstall|rename|archive)$/.test(p),
    );
    expect(writeLike).toEqual([]);
    expect(ROLE_PRESETS.viewer).toContain("console.read");
  });

  it("donne au propriétaire toutes les permissions existantes", () => {
    expect(ROLE_PRESETS.owner).toHaveLength(SERVER_PERMISSIONS.length);
  });

  it("interdit au développeur de gérer les accès et de réinstaller", () => {
    // Un développeur touche au code et aux fichiers, il ne redistribue pas
    // l'accès au serveur et ne peut pas en écraser l'installation.
    expect(ROLE_PRESETS.developer.some((p) => p.startsWith("subusers."))).toBe(false);
    expect(ROLE_PRESETS.developer).not.toContain("settings.reinstall");
  });

  it("classe les rôles par pouvoir croissant", () => {
    expect(ROLE_PRESETS.viewer.length).toBeLessThan(ROLE_PRESETS.moderator.length);
    expect(ROLE_PRESETS.moderator.length).toBeLessThan(ROLE_PRESETS.developer.length);
    expect(ROLE_PRESETS.developer.length).toBeLessThan(ROLE_PRESETS.owner.length);
  });

  it("n'accorde que des permissions déclarées", () => {
    for (const [role, permissions] of Object.entries(ROLE_PRESETS)) {
      for (const permission of permissions) {
        expect(SERVER_PERMISSIONS, `${role} : ${permission}`).toContain(permission);
      }
    }
  });
});

describe("catalogue des permissions", () => {
  const listed = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.value));

  it("couvre toutes les permissions existantes", () => {
    // Une permission absente du catalogue est vérifiable par l'API mais
    // impossible à accorder depuis l'écran : elle n'existe pour personne.
    const missing = SERVER_PERMISSIONS.filter((p) => !listed.includes(p));
    expect(missing).toEqual([]);
  });

  it("n'en décrit aucune deux fois", () => {
    // Deux cases pour la même permission se désynchronisent : décocher l'une
    // laisserait l'autre cochée, et le droit resterait accordé.
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("n'en invente aucune", () => {
    const unknown = listed.filter((p) => !SERVER_PERMISSIONS.includes(p));
    expect(unknown).toEqual([]);
  });

  it("chaque preset ne contient que des permissions réelles", () => {
    for (const [name, granted] of Object.entries(ROLE_PRESETS)) {
      const unknown = granted.filter((p) => !SERVER_PERMISSIONS.includes(p));
      expect(unknown, `preset ${name}`).toEqual([]);
    }
  });
});
