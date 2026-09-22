import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SERVER_PERMISSIONS } from "@gamedashboard/contracts";
import { describe, expect, it } from "vitest";

/**
 * Toute permission déclarée doit être exigée quelque part.
 *
 * `files.archive` figurait au catalogue depuis le début. Elle s'affichait dans
 * l'écran des sous-utilisateurs, se cochait, s'enregistrait — et n'ouvrait
 * rien : aucune route ne compressait quoi que ce soit. Un interrupteur qui
 * n'allume rien est pire qu'un interrupteur absent, parce qu'on croit avoir
 * accordé un droit, ou l'avoir refusé.
 *
 * Le contrôle est **grossier à dessein** : il cherche la chaîne, pas l'appel.
 * Vérifier qu'une permission garde la bonne route demanderait de comprendre le
 * routage, et un test qu'on ne peut pas lire ne se maintient pas. Celui-ci
 * répond à la seule question qui se pose en pratique — « cette case
 * correspond-elle à quelque chose ? » — et il l'aurait vu venir.
 */

/** Racine des sources de l'API, depuis ce fichier. */
const API_SOURCE = join(import.meta.dirname, "..", "..");

/**
 * Permissions construites à l'exécution, donc introuvables en clair.
 *
 * `power.*` est résolue par `` `power.${signal}` `` : une seule route garde les
 * quatre, et c'est la bonne façon de l'écrire — quatre routes identiques à un
 * mot près seraient pires. L'exemption est nominative pour que l'ajout d'une
 * cinquième permission d'alimentation reste un geste conscient.
 */
const CONSTRUITES: Partial<Record<string, string>> = {
  "power.start": "résolue par `power.<signal>` dans server-runtime.controller",
  "power.stop": "résolue par `power.<signal>` dans server-runtime.controller",
  "power.restart": "résolue par `power.<signal>` dans server-runtime.controller",
  "power.kill": "résolue par `power.<signal>` dans server-runtime.controller",
};

function sourcesDe(directory: string): string {
  let out = "";
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) out += sourcesDe(full);
    else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      out += readFileSync(full, "utf8");
    }
  }
  return out;
}

describe("couverture des permissions", () => {
  const sources = sourcesDe(API_SOURCE);

  it("exige chaque permission déclarée, ou l'exempte nommément", () => {
    const orphelines = SERVER_PERMISSIONS.filter(
      (permission) => !sources.includes(`"${permission}"`) && !CONSTRUITES[permission],
    );

    expect(orphelines).toEqual([]);
  });

  /**
   * L'exemption ne doit pas survivre à ce qu'elle exempte.
   *
   * Une permission retirée du catalogue laisserait sinon sa dispense derrière
   * elle, prête à couvrir une future permission du même nom sans que personne
   * ne l'ait décidé.
   */
  it("n'exempte que des permissions qui existent", () => {
    const fantomes = Object.keys(CONSTRUITES).filter(
      (permission) => !SERVER_PERMISSIONS.includes(permission as never),
    );

    expect(fantomes).toEqual([]);
  });
});
