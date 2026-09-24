import { afterEach, describe, expect, it, vi } from "vitest";
import { accountNav } from "@/config/navigation";

/**
 * La vitrine `/design` n'est pas servie en production (NC-53, ASVS 14.2.2).
 *
 * Le défaut : cet écran de développement — tous les composants, sur des
 * données factices (`lib/mock.ts`) — était servi à tout utilisateur connecté
 * du panel en production, et la navigation y menait. Il sert à vérifier les
 * thèmes pendant qu'on écrit un composant, pas à être exploré.
 */

vi.mock("@/components/design-showcase", () => ({ DesignShowcase: () => null }));

const { default: DesignPage } = await import("./page");

const t = (cle: string) => cle;
const liens = () =>
  accountNav(t, { isAdmin: true, isReseller: true }).flatMap((section) =>
    section.items.map((item) => item.href),
  );

describe("vitrine /design", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("répond « introuvable » en production", () => {
    vi.stubEnv("NODE_ENV", "production");
    // `notFound()` lève l'erreur que Next traduit en 404.
    expect(() => DesignPage()).toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("disparaît de la navigation en production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(liens()).not.toContain("/design");
  });

  it("reste là en développement, pour vérifier les thèmes", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => DesignPage()).not.toThrow();
    expect(liens()).toContain("/design");
  });
});
