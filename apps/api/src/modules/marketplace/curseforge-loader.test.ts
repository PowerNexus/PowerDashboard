import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Le chargeur du serveur doit restreindre la recherche CurseForge.
 *
 * Le paramètre `loader` était **reçu et ignoré** : la signature promettait un
 * filtrage qui n'avait pas lieu. Sur un serveur Paper, CurseForge rendait donc
 * des mods Forge — triés par popularité, toutes catégories confondues — et le
 * panel les annonçait « installables ». Déposés dans `plugins/`, ils n'auraient
 * rien fait.
 *
 * Le contrôle porte sur la **source**, pas sur un appel réseau : interroger
 * CurseForge dans un test le rendrait lent, dépendant d'une clé et capable
 * d'échouer parce qu'un tiers est en panne. Ce qu'on veut garder ici est une
 * décision de conception — « la recherche est filtrée » — et elle se lit dans
 * le fichier.
 */
const SOURCE = readFileSync(join(import.meta.dirname, "curseforge.client.ts"), "utf8");

describe("recherche CurseForge", () => {
  it("restreint la recherche à la catégorie du chargeur", () => {
    expect(SOURCE).toContain('params.set("classId"');
  });

  it("distingue les plugins Bukkit des mods", () => {
    // 5 : plugins Bukkit. 6 : mods. Les confondre est précisément le défaut
    // que ce test garde — un serveur Paper ne doit pas se voir proposer l'autre.
    expect(SOURCE).toContain("MINECRAFT_CLASS = { plugins: 5, mods: 6 }");
  });

  /**
   * Le repli ne doit plus affirmer « compatible avec tout ».
   *
   * C'est l'autre moitié du défaut : CurseForge n'annonce pas toujours le
   * chargeur d'un fichier, et le panel traduisait ce silence en `any`. Une
   * valeur inconnue devenait une affirmation — exactement ce que ce dépôt
   * évite partout ailleurs.
   */
  it("ne transforme plus un chargeur inconnu en « compatible avec tout »", () => {
    expect(SOURCE).not.toContain('loaders.length > 0 ? [...new Set(loaders)] : ["any"]');
    expect(SOURCE).toContain("[chargeurParDefaut]");
  });
});
