import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { battre } from "./background-tick";

describe("battre", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ne rejette jamais : une tâche en échec est consignée, pas propagée", async () => {
    const logger = new Logger("essai");
    const erreur = vi.spyOn(logger, "error").mockImplementation(() => {});
    await expect(
      battre(logger, "tâche", async () => {
        throw new Error("base tombée");
      }),
    ).resolves.toBeUndefined();
    expect(erreur).toHaveBeenCalledWith("tâche : base tombée");
  });

  /**
   * Une version en répétition (mise à jour autonome) partage la base de celle
   * en service : ses tâches de fond doubleraient sauvegardes, courriels et
   * webhooks.
   */
  it("ne lance aucune tâche dans une version en répétition", async () => {
    vi.stubEnv("GAMEDASHBOARD_ESSAI", "1");
    const tache = vi.fn(async () => {});
    await battre(new Logger("essai"), "tâche", tache);
    expect(tache).not.toHaveBeenCalled();
  });
});
