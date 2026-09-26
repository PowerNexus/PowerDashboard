import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AdminActionsService } from "./admin-actions.service";

/** Rien n'est câblé : l'adresse doit être refusée avant tout accès. */
const service = new AdminActionsService(
  ...(Array.from({ length: 6 }, () => ({})) as ConstructorParameters<typeof AdminActionsService>),
);

const creer = (email: string) =>
  service.createUser({
    email,
    nameFirst: "Ada",
    nameLast: "Lovelace",
    role: "user",
    withPassword: true,
  });

describe("adresse d'un compte créé par l'administration", () => {
  it("refuse une adresse de plus de 254 caractères", async () => {
    await expect(creer(`a@${"b".repeat(250)}.fr`)).rejects.toThrow(BadRequestException);
  });

  // Non-régression (CodeQL js/polynomial-redos) : sur un corps d'un mégaoctet,
  // l'expression tenait la boucle d'événements de l'API plusieurs minutes.
  it("refuse sans délai une adresse démesurée", async () => {
    const debut = performance.now();
    await expect(creer(`!@!.${"!.".repeat(500_000)}@`)).rejects.toThrow("Adresse e-mail invalide.");
    expect(performance.now() - debut).toBeLessThan(500);
  });
});
