import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { WingsClientService } from "../wings/wings-client.service";
import { type MountInput, MountsService } from "./mounts.service";

/** Une base qui signale qu'on l'a atteinte : la saisie a donc passé la validation. */
const ATTEINTE = new Error("base atteinte");
const base = new Proxy(
  {},
  {
    get: () => () => {
      throw ATTEINTE;
    },
  },
);
const service = new MountsService(base as never, {} as WingsClientService);

const montage = (champs: Partial<MountInput>): MountInput => ({
  name: "Cartes",
  source: "/srv/cartes",
  target: "/home/container/cartes",
  readOnly: true,
  userMountable: false,
  ...champs,
});

async function refus(champs: Partial<MountInput>): Promise<string> {
  const erreur = await service.create(montage(champs)).catch((e: unknown) => e);
  expect(erreur).toBeInstanceOf(BadRequestException);
  return (erreur as BadRequestException).message;
}

describe("chemins des montages", () => {
  it("laisse passer un dossier ordinaire, avec ou sans barre finale", async () => {
    await expect(service.create(montage({}))).rejects.toBe(ATTEINTE);
    await expect(service.create(montage({ source: "/srv/cartes/" }))).rejects.toBe(ATTEINTE);
  });

  it("refuse les racines de l'hôte écrites telles quelles", async () => {
    expect(await refus({ source: "/etc" })).toMatch(/n'est pas montable/);
    expect(await refus({ source: "/var/lib/docker/volumes" })).toMatch(/n'est pas montable/);
  });

  // Non-régression : Docker lit ces formes comme /etc et /var/lib/docker, que
  // la comparaison à la forme écrite laissait passer.
  it.each(["//etc", "/./etc", "/etc/.", "/var//lib/docker", "/var/lib/./docker", "//"])(
    "refuse la forme détournée « %s »",
    async (source) => {
      expect(await refus({ source })).toMatch(/forme simple/);
    },
  );

  it("refuse une cible qui recouvre la racine du serveur, sous toutes ses formes", async () => {
    expect(await refus({ target: "/home/container//" })).toMatch(/racine du serveur/);
    expect(await refus({ target: "/home/container/." })).toMatch(/forme simple/);
    expect(await refus({ target: "/home//container" })).toMatch(/forme simple/);
  });

  // Non-régression (CodeQL js/polynomial-redos) : une suite de barres suivie
  // d'un autre caractère rendait quadratique le retrait des barres finales
  // (plusieurs secondes à 80 000 caractères).
  it("refuse sans délai un chemin démesuré", async () => {
    const debut = performance.now();
    expect(await refus({ source: `/srv${"/".repeat(80_000)}x` })).toBe("Chemin trop long.");
    expect(performance.now() - debut).toBeLessThan(500);
  });
});
