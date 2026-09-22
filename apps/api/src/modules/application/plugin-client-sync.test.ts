import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Les plugins embarquent tous le **même** client d'API.
 *
 * Un plugin s'installe en copiant un dossier chez le client : il doit donc
 * être autonome, et chacun porte sa copie de `GameDashboardClient.php`. Trois
 * copies d'un fichier qui parle à notre API, c'est trois occasions de corriger
 * un défaut à un seul endroit et de le laisser vivre dans les deux autres —
 * avec, à la clé, un module WHMCS qui ne gère pas une erreur que le module
 * HostBill gère depuis six mois.
 *
 * `plugins/shared/` fait foi. Ce contrôle refuse toute copie qui s'en écarte,
 * et dit laquelle. La correction est une commande de copie, pas une enquête.
 *
 * Le contrôle vit ici parce que c'est la suite de tests qui tourne à chaque
 * modification. Un script PHP qu'il faudrait penser à lancer ne servirait
 * qu'une fois — celle où l'on se souvient qu'il existe.
 */

const RACINE = join(import.meta.dirname, "..", "..", "..", "..", "..");
const SOURCE = join(RACINE, "plugins", "shared", "GameDashboardClient.php");

/** Où chaque plugin attend sa copie, selon la disposition que son hôte impose. */
const COPIES = [
  join(RACINE, "plugins", "hostbill", "includes", "GameDashboardClient.php"),
  join(RACINE, "plugins", "whmcs", "GameDashboardClient.php"),
  join(
    RACINE,
    "plugins",
    "clientxcms",
    "modules",
    "gamedashboard",
    "src",
    "GameDashboardClient.php",
  ),
];

function empreinte(chemin: string): string {
  return createHash("sha256").update(readFileSync(chemin)).digest("hex");
}

describe("client d'API des plugins", () => {
  it("chaque plugin embarque la copie de référence, à l'octet près", () => {
    const attendue = empreinte(SOURCE);

    const divergentes = COPIES.filter((chemin) => empreinte(chemin) !== attendue).map((chemin) =>
      chemin.slice(RACINE.length + 1).replace(/\\/g, "/"),
    );

    expect(divergentes).toEqual([]);
  });

  it("la référence porte bien le client, et non un fichier vide", () => {
    // Sans ce garde-fou, trois fichiers vides passeraient le contrôle
    // précédent pour la plus mauvaise des raisons.
    const source = readFileSync(SOURCE, "utf8");
    expect(source).toContain("class GameDashboardClient");
    expect(source).toContain("function ssoLink");
  });
});
