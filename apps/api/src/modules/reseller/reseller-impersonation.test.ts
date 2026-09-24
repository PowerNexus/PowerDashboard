import "reflect-metadata";
import { type ExecutionContext, ForbiddenException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { ImpersonationReadOnlyGuard } from "../auth/impersonation.guard";
import { SessionGuard } from "../auth/session.guard";
import { ResellerController } from "./reseller.controller";

/**
 * L'espace revendeur pendant une prise en main (NC-06).
 *
 * Le garde de lecture seule manquait sur `ResellerController`, et un compte
 * `reseller` était une cible admise : l'agent agissait sous le nom du
 * revendeur — se donner le consentement « provisionnement plateforme »,
 * émettre une clé, supprimer un serveur —, et le journal l'imputait au
 * revendeur. La cible est désormais refusée (`impersonationTarget`) ; ce
 * garde est la ceinture, pour une session empruntée qui deviendrait celle
 * d'un revendeur après coup (promotion de la cible en cours de route).
 */
describe("prise en main de l'espace revendeur", () => {
  const guards = Reflect.getMetadata(GUARDS_METADATA, ResellerController) as unknown[];

  it("tient l'espace en lecture seule, après avoir reconnu la session", () => {
    expect(guards).toContain(ImpersonationReadOnlyGuard);
    expect(guards.indexOf(SessionGuard)).toBeLessThan(guards.indexOf(ImpersonationReadOnlyGuard));
  });

  it("refuse une écriture faite par une session empruntée, laisse la lecture", () => {
    const session = (method: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            method,
            user: { id: "r", role: "reseller", impersonator: { id: "a", email: "a@x.test" } },
          }),
        }),
      }) as unknown as ExecutionContext;

    const garde = new ImpersonationReadOnlyGuard();
    expect(garde.canActivate(session("GET"))).toBe(true);
    for (const method of ["POST", "DELETE"]) {
      expect(() => garde.canActivate(session(method))).toThrow(ForbiddenException);
    }
  });
});
