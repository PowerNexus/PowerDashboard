import { describe, expect, it } from "vitest";
import {
  APPLICATION_SCOPE_CATALOGUE,
  APPLICATION_SCOPES,
  type ApplicationScope,
  hasApplicationScope,
  isApplicationScope,
  isUsableIdempotencyKey,
} from "./application-api";

describe("isApplicationScope", () => {
  it("reconnaît une portée du catalogue", () => {
    expect(isApplicationScope("servers.create")).toBe(true);
  });

  it("refuse une portée inventée", () => {
    expect(isApplicationScope("servers.everything")).toBe(false);
  });

  it("refuse une permission de serveur, qui appartient à l'autre système de clés", () => {
    // `power.restart` est une portée de clé **personnelle**. L'accepter ici
    // laisserait croire qu'une clé applicative peut redémarrer un serveur,
    // alors qu'aucune route de cette API ne le propose.
    expect(isApplicationScope("power.restart")).toBe(false);
  });
});

describe("hasApplicationScope", () => {
  it("accorde ce qui est explicitement accordé", () => {
    expect(hasApplicationScope(["servers.create"], "servers.create")).toBe(true);
  });

  it("n'accorde rien par joker", () => {
    // Le jour où une portée est ajoutée, un joker l'aurait donnée
    // rétroactivement à toutes les clés existantes.
    expect(hasApplicationScope(["*"], "users.delete")).toBe(false);
    expect(hasApplicationScope(["servers.*"], "servers.delete")).toBe(false);
  });

  it("ne déduit pas la lecture de l'écriture", () => {
    expect(hasApplicationScope(["users.write"], "users.read")).toBe(false);
  });

  it("ne déduit pas la suppression de la création", () => {
    // La confusion la plus coûteuse de la liste : un système qui provisionne
    // n'a aucune raison de pouvoir effacer.
    expect(hasApplicationScope(["servers.create"], "servers.delete")).toBe(false);
  });

  it("refuse tout à une clé sans portée", () => {
    for (const scope of APPLICATION_SCOPES) {
      expect(hasApplicationScope([], scope)).toBe(false);
    }
  });
});

describe("APPLICATION_SCOPE_CATALOGUE", () => {
  it("décrit exactement les portées existantes", () => {
    // Une portée absente du catalogue est vérifiable par l'API mais impossible
    // à accorder depuis l'écran : elle n'existe donc pour personne.
    const listed = APPLICATION_SCOPE_CATALOGUE.flatMap((group) =>
      group.scopes.map((entry) => entry.scope),
    ).sort();
    expect(listed).toEqual([...APPLICATION_SCOPES].sort());
  });

  it("ne décrit aucune portée deux fois", () => {
    const listed = APPLICATION_SCOPE_CATALOGUE.flatMap((group) =>
      group.scopes.map((entry) => entry.scope),
    );
    expect(new Set<ApplicationScope>(listed).size).toBe(listed.length);
  });
});

describe("isUsableIdempotencyKey", () => {
  it("refuse une clé trop courte pour être unique", () => {
    // Deux systèmes qui envoient « 1 » se verraient répondre la commande de
    // l'autre.
    expect(isUsableIdempotencyKey("1")).toBe(false);
    expect(isUsableIdempotencyKey("abc")).toBe(false);
  });

  it("accepte un identifiant de commande réaliste", () => {
    expect(isUsableIdempotencyKey("order-2026-000148")).toBe(true);
  });

  it("refuse une clé démesurée", () => {
    expect(isUsableIdempotencyKey("x".repeat(5000))).toBe(false);
  });

  it("ne se laisse pas tromper par des espaces", () => {
    expect(isUsableIdempotencyKey("        ")).toBe(false);
  });
});
