import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_USER_CONNECTIONS } from "./index";

describe("plafond de connexions", () => {
  it("laisse largement la place à l'usage normal d'un serveur de jeu", () => {
    // Un pool typique en ouvre deux à cinq. Le plafond arrête l'emballement,
    // il ne gêne pas l'usage.
    expect(DEFAULT_MAX_USER_CONNECTIONS).toBeGreaterThanOrEqual(10);
  });

  it("reste très en dessous du plafond d'un hôte MySQL", () => {
    /*
     * `max_connections` vaut 151 par défaut sur MySQL. Un plafond par
     * utilisateur proche de cette valeur ne protégerait de rien : un seul
     * voisin pourrait encore épuiser l'hôte et emporter tous les autres.
     */
    expect(DEFAULT_MAX_USER_CONNECTIONS).toBeLessThan(50);
  });
});
