import "reflect-metadata";
import type { ExecutionContext } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import type { DenialLogService } from "../activity/denial-log.service";
import { AdminController } from "./admin.controller";
import { AdminGuard } from "./admin.guard";
import { AdminWriteGuard } from "./admin-write.guard";

/**
 * Routes d'administration réservées au rôle administrateur.
 *
 * Le contrôleur entier laisse lire le support (`AdminGuard`) ; ces routes-ci
 * ajoutent `AdminWriteGuard`. L'oubli ne se verrait nulle part : la route
 * marcherait, simplement pour une personne de trop. D'où ce contrôle, qui
 * lit les gardes réellement posés sur chaque méthode.
 */
const RESERVED = ["exportActivity", "saveSubuserPresets", "resetSubuserPresets"] as const;

function guardsOf(method: (typeof RESERVED)[number]): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, AdminController.prototype[method]) ?? [];
}

/** Le journal des refus, muet : le sujet est ici le rôle, pas la trace. */
const silence = { record: async () => {} } as unknown as DenialLogService;

function context(request: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe("routes d'administration réservées", () => {
  it.each(RESERVED)("%s exige le rôle administrateur", (method) => {
    expect(guardsOf(method)).toContain(AdminWriteGuard);
  });

  it("le contrôleur exige au moins l'accès à l'administration", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminController)).toContain(AdminGuard);
  });

  it("refuse le support, qui peut pourtant lire le journal", () => {
    // Le support lit le journal pour répondre à un client ; l'emporter entier
    // hors du panel est un autre geste.
    const support = { user: { id: "x", role: "support" }, scopes: null };
    expect(new AdminGuard(silence).canActivate(context(support))).toBe(true);
    expect(() => new AdminWriteGuard().canActivate(context(support))).toThrow(
      "rôle administrateur",
    );
  });

  it("refuse une clé d'API, même d'un compte administrateur", () => {
    const cle = { user: { id: "x", role: "admin" }, scopes: ["activity.read"] };
    expect(() => new AdminWriteGuard().canActivate(context(cle))).toThrow("clés d'API");
  });

  it("laisse passer un administrateur connecté au panel", () => {
    const admin = { user: { id: "x", role: "admin" }, scopes: null };
    expect(new AdminWriteGuard().canActivate(context(admin))).toBe(true);
  });
});
