import { describe, expect, it } from "vitest";
import {
  defaultRolePresets,
  ROLE_PRESETS,
  RolePresetsInput,
  resolveRolePresets,
} from "./permissions";

/** Un jeu valide, dont chaque test ne change que ce qu'il éprouve. */
function valid() {
  return {
    viewer: ["console.read"],
    moderator: ["console.read", "power.restart"],
    developer: ["files.read", "files.write"],
  };
}

/** Le premier message de refus, celui que l'API renvoie à l'écran. */
function refusal(input: unknown): string | undefined {
  const parsed = RolePresetsInput.safeParse(input);
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
}

describe("validation des presets", () => {
  it("accepte un jeu de permissions de serveur", () => {
    expect(RolePresetsInput.safeParse(valid()).success).toBe(true);
  });

  it("refuse une permission d'administration, en la nommant", () => {
    // Un preset délègue des droits sur un serveur, jamais sur la plateforme.
    const message = refusal({ ...valid(), moderator: ["console.read", "admin.users.write"] });
    expect(message).toContain("admin.users.write");
    expect(message).toContain("administration");
  });

  it("refuse une permission inconnue, en la nommant", () => {
    expect(refusal({ ...valid(), viewer: ["console.lire"] })).toContain("console.lire");
  });

  it("refuse un preset vide : l'invitation qu'il pré-remplirait serait refusée", () => {
    expect(refusal({ ...valid(), developer: [] })).toBeDefined();
  });

  it("refuse « owner » et toute clé inconnue plutôt que de les ignorer", () => {
    expect(refusal({ ...valid(), owner: ["console.read"] })).toBeDefined();
    expect(refusal({ viewer: ["console.read"], moderator: ["console.read"] })).toBeDefined();
  });

  it("retire les doublons", () => {
    const parsed = RolePresetsInput.parse({ ...valid(), viewer: ["console.read", "console.read"] });
    expect(parsed.viewer).toEqual(["console.read"]);
  });
});

describe("presets en vigueur", () => {
  it("retombe sur ceux du code quand rien n'est enregistré", () => {
    const view = resolveRolePresets(undefined);
    expect(view.presets).toEqual(defaultRolePresets());
    expect(view.presets.viewer).toEqual([...ROLE_PRESETS.viewer]);
    expect(view.customized).toEqual([]);
  });

  it("prend ce que l'administration a enregistré", () => {
    const view = resolveRolePresets(valid());
    expect(view.presets).toEqual(valid());
    expect(view.defaults).toEqual(defaultRolePresets());
    expect(view.customized).toEqual(["viewer", "moderator", "developer"]);
  });

  it("retombe preset par preset sur le code quand une valeur enregistrée est illisible", () => {
    // Une permission retirée du catalogue depuis l'enregistrement, par
    // exemple : seul ce preset revient au code, les autres restent.
    const view = resolveRolePresets({ ...valid(), moderator: ["permission.disparue"] });
    expect(view.presets.moderator).toEqual([...ROLE_PRESETS.moderator]);
    expect(view.presets.viewer).toEqual(["console.read"]);
    expect(view.customized).toEqual(["viewer", "developer"]);
  });

  it("ne sert jamais une permission d'administration glissée en base à la main", () => {
    const view = resolveRolePresets({ ...valid(), viewer: ["admin.settings"] });
    expect(view.presets.viewer).toEqual([...ROLE_PRESETS.viewer]);
  });

  it("ignore une ligne qui n'est pas un objet", () => {
    expect(resolveRolePresets("n'importe quoi").presets).toEqual(defaultRolePresets());
    expect(resolveRolePresets([1, 2]).presets).toEqual(defaultRolePresets());
  });

  it("ne compte pas comme modifié un preset réenregistré à l'identique, dans un autre ordre", () => {
    const defaults = defaultRolePresets();
    const view = resolveRolePresets({ ...defaults, viewer: [...defaults.viewer].reverse() });
    expect(view.customized).toEqual([]);
  });
});
