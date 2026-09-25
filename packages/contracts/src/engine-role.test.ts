import { describe, expect, it } from "vitest";
import { ENGINE_EXCLUSIONS, engineRoleOf } from "./engine";

/**
 * Quelles plateformes on peut proposer à un serveur.
 *
 * Ce test existe à cause d'un défaut de conception, pas d'une faute de frappe :
 * l'écran filtrait par **famille de chargeur**. Un serveur Paper ne se voyait
 * proposer que Paper, Folia, Purpur et Vanilla — jamais Fabric. Autrement dit,
 * on ne pouvait changer de chargeur qu'à condition de rester dans le même, ce
 * qui vide de son sens l'écran entier.
 *
 * Le seul filtre légitime est le rôle : poser un proxy à la place d'un serveur
 * de jeu donnerait un serveur sans monde, et l'inverse un monde que personne
 * ne sait joindre.
 */
describe("engineRoleOf", () => {
  it("range tous les chargeurs Minecraft-Java du même côté", () => {
    // C'est le cœur du correctif : ces quatre-là doivent pouvoir devenir l'un
    // l'autre, puisque c'est exactement ce qu'on vient faire sur cet écran.
    for (const loader of ["paper", "spigot", "fabric", "forge"]) {
      expect(engineRoleOf(loader), `« ${loader} » devrait être un serveur de jeu.`).toBe("game");
    }
  });

  it("traite Vanilla comme un serveur de jeu", () => {
    // Son chargeur est « any » : il n'en a pas. Il reste un serveur de jeu, et
    // c'est même celui qui a le plus de raisons de changer de moteur — il
    // n'accepte ni plugin ni mod.
    expect(engineRoleOf("any")).toBe("game");
    expect(engineRoleOf("vanilla")).toBe("game");
  });

  it("isole le proxy", () => {
    // Velocity n'héberge aucun monde. Le proposer à un serveur de jeu, ou
    // l'inverse, donnerait une machine qui tourne et ne sert à rien.
    expect(engineRoleOf("velocity")).toBe("proxy");
  });

  it("ne propose rien aux jeux qui ne sont pas Minecraft-Java", () => {
    // Poser un jar de Minecraft sur un serveur Rust donnerait un fichier que
    // rien ne sait lancer. `null` veut dire « aucune de ces plateformes ».
    expect(engineRoleOf("oxide")).toBeNull();
    expect(engineRoleOf("carbon")).toBeNull();
    expect(engineRoleOf("inconnu")).toBeNull();
  });
});

describe("ENGINE_EXCLUSIONS", () => {
  it("nomme chaque absence et la justifie", () => {
    /*
     * Dire « Quilt n'est pas là » sans dire pourquoi fait chercher une panne
     * du panel. Ces raisons sont des faits relevés chez l'éditeur : la méta
     * de Quilt rend un profil de lancement et non un jar.
     */
    expect(ENGINE_EXCLUSIONS.length).toBeGreaterThan(0);

    for (const exclusion of ENGINE_EXCLUSIONS) {
      expect(exclusion.label.length).toBeGreaterThan(2);
      // Une raison courte serait un constat, pas une explication.
      expect(
        exclusion.reason.length,
        `L'absence de « ${exclusion.label} » n'est pas expliquée.`,
      ).toBeGreaterThan(60);
    }
  });

  it("explique l'absence de Quilt, et ne présente plus Forge ni NeoForge comme absents", () => {
    const texte = ENGINE_EXCLUSIONS.map((e) => `${e.label} ${e.reason}`).join(" ");
    expect(texte).toContain("Quilt");
    // Régression : l'écran disait Forge et NeoForge non pris en charge, alors
    // que leur chargeur est posé avec le modpack qui les demande.
    expect(texte).not.toMatch(/Forge/);
  });
});
