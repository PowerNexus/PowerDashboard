import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportPterodactylEgg, parsePterodactylEgg } from "@gamedashboard/contracts";
import { describe, expect, it } from "vitest";

/**
 * Aller-retour export → import sur l'egg Minecraft Java livré avec le panel.
 *
 * Ici plutôt que dans `contracts`, qui ne lit pas de fichiers : c'est un vrai
 * export, avec un script d'installation de plusieurs centaines de lignes et
 * des blocs de configuration sérialisés par Pterodactyl — ce qu'aucun exemple
 * écrit pour un test ne reproduit.
 */
describe("export de l'egg Minecraft Java livré", () => {
  it("redonne le même egg une fois réimporté", () => {
    const chemin = fileURLToPath(
      new URL("../../../../../infra/eggs/minecraft-java/egg.json", import.meta.url),
    );
    const lu = parsePterodactylEgg(JSON.parse(readFileSync(chemin, "utf8")));

    expect(lu.variables.length).toBeGreaterThan(0);
    expect(lu.installScript.length).toBeGreaterThan(1000);
    // Les commandes de la vue joueurs survivent à l'aller-retour.
    expect(lu.playerCommands.kick).toBe("kick {player} {reason}");
    expect(parsePterodactylEgg(exportPterodactylEgg(lu))).toEqual(lu);
  });
});
