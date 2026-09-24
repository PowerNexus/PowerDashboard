import type { ExecutionContext } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Denial, DenialLogService } from "../activity/denial-log.service";
import { AdminGuard } from "./admin.guard";

/**
 * Refus de l'espace d'administration, consignés (NC-12).
 *
 * Un compte client qui essayait les routes d'administration une à une ne
 * laissait aucune trace : le 404 partait, rien ne s'écrivait. Il part
 * toujours — répondre autre chose confirmerait que l'espace existe — mais le
 * journal le retient.
 */

function garde() {
  const refus: Denial[] = [];
  const denials = {
    record: vi.fn(async (denial: Denial) => {
      refus.push(denial);
    }),
  } as unknown as DenialLogService;
  return { guard: new AdminGuard(denials), refus };
}

function context(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        ip: "203.0.113.20",
        method: "GET",
        url: "/api/v1/admin/users?q=x",
        routeOptions: { url: "/api/v1/admin/users" },
        ...request,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe("AdminGuard : refus consignés", () => {
  it("consigne un compte sans rôle d'administration, et répond toujours 404", () => {
    const { guard, refus } = garde();
    const client = { user: { id: "u1", role: "user" }, scopes: null };

    expect(() => guard.canActivate(context(client))).toThrow(NotFoundException);
    expect(refus).toEqual([
      {
        event: "access.denied",
        actorId: "u1",
        actorType: "user",
        origin: { ip: "203.0.113.20", route: "GET /api/v1/admin/users" },
        properties: { area: "admin" },
      },
    ]);
  });

  it("consigne une clé d'API, même d'un administrateur", () => {
    const { guard, refus } = garde();
    const cle = { user: { id: "a1", role: "admin" }, scopes: ["activity.read"] };

    expect(() => guard.canActivate(context(cle))).toThrow(NotFoundException);
    expect(refus[0]).toMatchObject({ actorId: "a1", actorType: "api_key" });
  });

  it("ne consigne rien pour le personnel", () => {
    const { guard, refus } = garde();
    for (const role of ["admin", "support"]) {
      expect(guard.canActivate(context({ user: { id: "s1", role }, scopes: null }))).toBe(true);
    }
    expect(refus).toEqual([]);
  });
});
