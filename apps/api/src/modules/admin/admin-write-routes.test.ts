import "reflect-metadata";
import type { ExecutionContext } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import {
  ADMIN_CONTROLLERS,
  guardsOf,
  routeLabel as label,
  type Route,
  routesOf,
  WRITE_METHODS,
} from "../../test/routes";
import type { DenialLogService } from "../activity/denial-log.service";
import { AdminGuard } from "./admin.guard";
import { AdminWriteGuard } from "./admin-write.guard";
import { StaffTwoFactorGuard } from "./staff-2fa.guard";

/**
 * Routes d'administration réservées au rôle administrateur.
 *
 * Chaque contrôleur de l'espace laisse lire le support (`AdminGuard`) ; les
 * routes qui écrivent ajoutent `AdminWriteGuard`. L'oubli ne se verrait
 * nulle part : la route marcherait, simplement pour une personne de trop.
 * D'où ce contrôle, qui lit les gardes réellement posés sur chaque méthode.
 *
 * **Toutes les méthodes d'écriture, relevées d'office.** La première version
 * tenait une liste de trois routes, choisies à la main : une route ajoutée
 * sans le garde n'y figurait évidemment pas, et le test passait. Ici, toute
 * méthode déclarée `POST`, `PUT`, `PATCH` ou `DELETE` sur un contrôleur de
 * l'espace est vérifiée, sans qu'on ait à y penser.
 */

/**
 * Lectures réservées elles aussi, pour ce qu'elles emportent : le journal
 * entier, le jeton d'un node en clair, les identifiants des services de la
 * plateforme (NC-40).
 */
const RESERVED_READS: Record<string, readonly string[]> = {
  AdminController: ["exportActivity", "nodeConfiguration", "settings"],
};

const ROUTES: Route[] = ADMIN_CONTROLLERS.flatMap(routesOf);
const WRITES = ROUTES.filter((route) => WRITE_METHODS.has(route.method));
const READS = ROUTES.filter((route) => RESERVED_READS[route.controller.name]?.includes(route.name));

/** Le journal des refus, muet : le sujet est ici le rôle, pas la trace. */
const silence = { record: async () => {} } as unknown as DenialLogService;

function context(request: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe("routes d'administration réservées", () => {
  it("relève bien les routes d'écriture de chaque contrôleur", () => {
    // Un relevé vide ferait passer tout le reste sans rien vérifier : c'est
    // l'échec silencieux qu'un contrôle de couverture ne doit pas avoir.
    for (const controller of ADMIN_CONTROLLERS) {
      expect(
        WRITES.some((route) => route.controller === controller),
        `${controller.name} : aucune route d'écriture relevée`,
      ).toBe(true);
    }
    expect(READS.map(label).sort()).toEqual(
      Object.entries(RESERVED_READS)
        .flatMap(([controller, names]) => names.map((name) => `${controller}.${name}`))
        .sort(),
    );
  });

  it.each(WRITES.map((route) => [label(route), route] as const))(
    "%s exige le rôle administrateur",
    (_, route) => {
      expect(guardsOf(route)).toContain(AdminWriteGuard);
    },
  );

  it.each(READS.map((route) => [label(route), route] as const))(
    "%s, une lecture, exige quand même le rôle administrateur",
    (_, route) => {
      expect(guardsOf(route)).toContain(AdminWriteGuard);
    },
  );

  it.each(ADMIN_CONTROLLERS.map((controller) => [controller.name, controller] as const))(
    "%s exige l'accès à l'administration et la seconde preuve du personnel",
    (_, controller) => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[];
      expect(guards).toContain(AdminGuard);
      expect(guards).toContain(StaffTwoFactorGuard);
      // L'ordre compte : le rôle se lit sur une session déjà résolue, et la
      // seconde preuve sur un membre du personnel déjà reconnu.
      expect(guards.indexOf(AdminGuard)).toBeLessThan(guards.indexOf(StaffTwoFactorGuard));
    },
  );

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
