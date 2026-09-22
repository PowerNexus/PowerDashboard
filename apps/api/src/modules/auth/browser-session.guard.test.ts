import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { BrowserSessionGuard } from "./browser-session.guard";

function contextWith(scopes: string[] | null | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ scopes }) }),
  } as unknown as ExecutionContext;
}

describe("BrowserSessionGuard", () => {
  it("laisse passer une session de navigateur", () => {
    // `null` est la marque d'une session : la personne agit en son nom propre.
    expect(new BrowserSessionGuard().canActivate(contextWith(null))).toBe(true);
  });

  it("refuse une clé d'API, même sans aucune portée", () => {
    // Le cas important : une liste vide ne veut pas dire « pas de
    // restriction ». La confondre avec `null` donnerait à une clé sans aucune
    // portée le droit de fermer les sessions de son propriétaire.
    expect(() => new BrowserSessionGuard().canActivate(contextWith([]))).toThrow(
      ForbiddenException,
    );
  });

  it("refuse une clé d'API quelles que soient ses portées", () => {
    expect(() => new BrowserSessionGuard().canActivate(contextWith(["*"]))).toThrow(
      ForbiddenException,
    );
  });

  it("dit par où passer plutôt que de refuser sèchement", () => {
    try {
      new BrowserSessionGuard().canActivate(contextWith(["power.start"]));
      expect.unreachable("la garde aurait dû refuser");
    } catch (error) {
      expect((error as ForbiddenException).message).toContain("Connectez-vous au panel");
    }
  });
});
