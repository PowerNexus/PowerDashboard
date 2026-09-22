import {
  MarketplaceSource,
  SERVER_MANAGED_STATES,
  SubuserRolePreset,
  UserRole,
} from "@gamedashboard/contracts";
import { describe, expect, it } from "vitest";
import { marketplaceSource, serverState, userRole } from "./enums";

/**
 * Les énumérations existent en double : en Zod pour les entrées de l'API, en
 * PostgreSQL pour tout ce qui écrit sans passer par elle — migration, script
 * d'import, console psql. Ce doublon n'a de valeur que si les deux listes
 * restent identiques ; une divergence produirait l'un des deux symptômes les
 * plus pénibles à diagnostiquer : une valeur acceptée par l'API que la base
 * refuse, ou une valeur présente en base que le panel ne sait pas afficher.
 */
describe("cohérence entre énumérations PostgreSQL et contrats Zod", () => {
  it("userRole correspond à UserRole", () => {
    expect([...userRole.enumValues]).toEqual([...UserRole.options]);
  });

  it("marketplaceSource correspond à MarketplaceSource", () => {
    expect([...marketplaceSource.enumValues]).toEqual([...MarketplaceSource.options]);
  });

  it("serverState ne contient que les états de gestion", () => {
    // La base ne stocke pas les états du conteneur : ils viennent de Wings et
    // n'ont pas de colonne (§8.2 du plan).
    expect([...serverState.enumValues]).toEqual([...SERVER_MANAGED_STATES]);
  });

  it("serverState exclut les états rapportés par le daemon", () => {
    for (const runtime of ["offline", "starting", "running", "stopping"]) {
      expect(serverState.enumValues).not.toContain(runtime);
    }
  });

  it("serverState exclut crash_loop, qui est déduit et non stocké", () => {
    expect(serverState.enumValues).not.toContain("crash_loop");
  });

  it("les presets de rôle du contrat restent des chaînes libres en base", () => {
    // `role_preset` est volontairement un varchar : les permissions effectives
    // sont stockées en clair à côté (§6.4), et un preset renommé ne doit pas
    // exiger une migration de type.
    expect(SubuserRolePreset.options.length).toBeGreaterThan(0);
  });
});
