import type { Database } from "@gamedashboard/db";
import { describe, expect, it, vi } from "vitest";
import { NodeLoadService } from "./node-load.service";

/**
 * La fenêtre vient de l'adresse (`?window=`) : elle ne doit jamais atteindre
 * les propriétés héritées de l'objet des fenêtres.
 *
 * `?window=constructor` lisait `Object.prototype.constructor`, une fonction
 * sans `hours` : la date de départ valait `NaN`, `toISOString()` levait, et
 * l'administration recevait une erreur 500 pour un paramètre d'URL.
 */
describe("fenêtre de la charge d'un node", () => {
  function service() {
    const execute = vi.fn(async () => []);
    return { execute, loads: new NodeLoadService({ execute } as unknown as Database) };
  }

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "« %s » retombe sur la journée au lieu de lever",
    async (fenetre) => {
      const { execute, loads } = service();
      await expect(loads.series("node", fenetre)).resolves.toEqual([]);
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );

  it("garde les fenêtres déclarées", async () => {
    const { execute, loads } = service();
    await loads.series("node", "7j");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
