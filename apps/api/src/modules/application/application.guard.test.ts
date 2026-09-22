import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { ApplicationGuard } from "./application.guard";
import type { ApplicationKeyRepository } from "./application-key.repository";

/**
 * Une clé d'intégration ordinaire : tout le parc, autant d'usages qu'on veut.
 *
 * La garde ne lit ni `nodeId` ni `singleUse` — elle ne connaît que les portées.
 * Ces deux-là sont l'affaire de la route de configuration, qui seule sait de
 * quel node il est question et quand la clé a fini de servir.
 */
const PRINCIPAL = {
  keyId: "k1",
  name: "Boutique",
  scopes: ["servers.create"],
  nodeId: null,
  resellerId: null,
  singleUse: false,
};

/** Contexte d'exécution minimal : la garde ne lit que la requête et les métadonnées. */
function contextFor(request: Record<string, unknown>, required: string[] | undefined) {
  const reflector = new Reflector();
  vi.spyOn(reflector, "getAllAndOverride").mockReturnValue(required);

  return {
    reflector,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => class {},
    } as never,
  };
}

function guardWith(
  resolve: ApplicationKeyRepository["resolve"],
  required: string[] | undefined,
  request: Record<string, unknown>,
) {
  const { reflector, context } = contextFor(request, required);
  const guard = new ApplicationGuard({ resolve } as ApplicationKeyRepository, reflector);
  return { guard, context };
}

const accepts = () => Promise.resolve(PRINCIPAL);
const refuses = () => Promise.resolve(null);

describe("ApplicationGuard", () => {
  it("laisse passer une clé valide portant la portée exigée", async () => {
    const { guard, context } = guardWith(accepts, ["servers.create"], {
      headers: { authorization: "Bearer gd_app_x_y" },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("attache le porteur à la requête, jamais un compte", async () => {
    // L'acte d'un système tiers n'est celui de personne : s'il portait un
    // utilisateur, le journal l'imputerait à un administrateur.
    const request: Record<string, unknown> = { headers: { authorization: "Bearer gd_app_x_y" } };
    const { guard, context } = guardWith(accepts, ["servers.create"], request);

    await guard.canActivate(context);

    expect(request.application).toEqual(PRINCIPAL);
    expect(request.user).toBeUndefined();
  });

  it("refuse une requête sans en-tête Authorization", async () => {
    const { guard, context } = guardWith(accepts, ["servers.create"], { headers: {} });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  /**
   * Le point qui sépare cette API de celle du panel.
   *
   * Un navigateur joint ses cookies tout seul : si la session suffisait ici,
   * n'importe quelle page visitée par un administrateur connecté pourrait
   * déclencher un provisionnement à son insu.
   */
  it("ignore un cookie de session, même valide", async () => {
    const { guard, context } = guardWith(accepts, ["servers.create"], {
      headers: {},
      cookies: { gd_session: "une-session-parfaitement-valide" },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("refuse une clé que le dépôt rejette", async () => {
    const { guard, context } = guardWith(refuses, ["servers.create"], {
      headers: { authorization: "Bearer gd_app_inconnue" },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("refuse une portée non accordée, et la nomme", async () => {
    const { guard, context } = guardWith(accepts, ["servers.delete"], {
      headers: { authorization: "Bearer gd_app_x_y" },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(/servers\.delete/);
  });

  /**
   * L'oubli et la décision ne se ressemblent pas.
   *
   * `undefined` — aucune déclaration — rend la route inutilisable, ce qui se
   * voit au premier appel. Le défaut inverse l'ouvrirait à toute clé valide,
   * ce qui ne se voit jamais.
   */
  it("refuse une route qui ne déclare aucune portée", async () => {
    const { guard, context } = guardWith(accepts, undefined, {
      headers: { authorization: "Bearer gd_app_x_y" },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("accepte une route déclarée explicitement sans portée", async () => {
    // `@RequireScopes()` sans argument : un choix écrit, réservé à /identity.
    const { guard, context } = guardWith(accepts, [], {
      headers: { authorization: "Bearer gd_app_x_y" },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("transmet l'adresse du client au dépôt, pour la liste d'adresses autorisées", async () => {
    const resolve = vi.fn().mockResolvedValue(PRINCIPAL);
    const { guard, context } = guardWith(resolve, ["servers.create"], {
      headers: { authorization: "Bearer gd_app_x_y" },
      ip: "203.0.113.10",
    });

    await guard.canActivate(context);
    expect(resolve).toHaveBeenCalledWith("gd_app_x_y", "203.0.113.10");
  });
});
