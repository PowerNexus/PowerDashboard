import "reflect-metadata";
import { type ExecutionContext, ForbiddenException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it, vi } from "vitest";
import { AuthController } from "../auth/auth.controller";
import type { TwoFactorRepository } from "../auth/two-factor.repository";
import { ResellerController } from "../reseller/reseller.controller";
import type { PlatformSettingsService } from "./platform-settings.service";
import { StaffTwoFactorGuard } from "./staff-2fa.guard";

/**
 * La seconde preuve exigée du personnel (et des revendeurs).
 *
 * Deux choses à tenir, et elles tirent en sens contraire : l'administration
 * refusée à qui n'a pas de second facteur quand la plateforme l'exige, et
 * l'espace de compte **ouvert** à ce même compte, puisque c'est là qu'il
 * l'enrôle. Fermer le second enfermerait dehors la personne qui vient réparer
 * précisément le premier.
 */
function guard(input: { required: boolean; enabled: boolean }) {
  const settings = { boolean: vi.fn(async () => input.required) };
  const twoFactor = { status: vi.fn(async () => ({ enabled: input.enabled })) };
  return {
    settings,
    twoFactor,
    guard: new StaffTwoFactorGuard(
      settings as unknown as PlatformSettingsService,
      twoFactor as unknown as TwoFactorRepository,
    ),
  };
}

function context(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const admin = { id: "a", role: "admin" };

describe("seconde preuve du personnel", () => {
  it("laisse `SessionGuard` trancher une requête sans utilisateur", async () => {
    const { guard: g, settings } = guard({ required: true, enabled: false });
    await expect(g.canActivate(context(undefined))).resolves.toBe(true);
    expect(settings.boolean).not.toHaveBeenCalled();
  });

  it("n'exige rien quand la plateforme ne le demande pas", async () => {
    const { guard: g, settings, twoFactor } = guard({ required: false, enabled: false });
    await expect(g.canActivate(context(admin))).resolves.toBe(true);
    expect(settings.boolean).toHaveBeenCalledWith("security.staffRequires2fa");
    expect(twoFactor.status).not.toHaveBeenCalled();
  });

  it("laisse passer un compte qui a une seconde preuve", async () => {
    const { guard: g, twoFactor } = guard({ required: true, enabled: true });
    await expect(g.canActivate(context(admin))).resolves.toBe(true);
    expect(twoFactor.status).toHaveBeenCalledWith("a");
  });

  it("refuse en 403, et dit où l'activer, un compte qui n'en a pas", async () => {
    const { guard: g } = guard({ required: true, enabled: false });
    const refus = g.canActivate(context(admin));
    await expect(refus).rejects.toBeInstanceOf(ForbiddenException);
    await expect(refus).rejects.toThrow(/sécurité de votre compte/);
  });

  it("est posé sur l'espace revendeur", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ResellerController)).toContain(StaffTwoFactorGuard);
  });

  it.each([
    "twoFactorStatus",
    "twoFactorSetup",
    "twoFactorEnable",
    "passkeyRegistrationOptions",
    "registerPasskey",
  ] as const)("n'est pas posé sur l'enrôlement (%s)", (method) => {
    const guards = [
      ...(Reflect.getMetadata(GUARDS_METADATA, AuthController) ?? []),
      ...(Reflect.getMetadata(GUARDS_METADATA, AuthController.prototype[method]) ?? []),
    ];
    expect(guards).not.toContain(StaffTwoFactorGuard);
  });
});
