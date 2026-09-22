import { describe, expect, it } from "vitest";
import { detectRuntime } from "./server-runtime";

const detect = (egg: string, nest = "Minecraft", vars: Record<string, string> = {}) =>
  detectRuntime(egg, nest, vars);

describe("détection du chargeur", () => {
  it("reconnaît Paper", () => {
    expect(detect("Paper")).toMatchObject({ loader: "paper", directory: "plugins" });
  });

  it("reconnaît Fabric et vise les mods, pas les plugins", () => {
    // Se tromper de dossier ne produit aucune erreur : le fichier est écrit,
    // le jeu ne le lit pas, et le mod paraît sans effet.
    expect(detect("Fabric")).toMatchObject({ loader: "fabric", directory: "mods" });
  });

  it("préfère Paper à Spigot quand les deux mots figurent", () => {
    // « Paper (compatible Spigot) » est un Paper. L'ordre des règles le décide,
    // et l'inverse proposerait un catalogue plus étroit que nécessaire.
    expect(detect("Paper (compatible Spigot)")).toMatchObject({ loader: "paper" });
  });

  it("reconnaît un proxy avant le serveur de jeu", () => {
    // Un proxy n'accepte pas les plugins d'un serveur de jeu : les confondre
    // ferait installer des plugins qui empêchent le démarrage.
    expect(detect("Velocity")).toMatchObject({ loader: "velocity" });
  });

  it("reconnaît Purpur comme un dérivé de Paper", () => {
    expect(detect("Purpur")).toMatchObject({ loader: "paper", directory: "plugins" });
  });

  it("place les plugins Rust dans le dossier d'Oxide", () => {
    expect(detect("Rust (Oxide)", "Rust")).toMatchObject({
      loader: "oxide",
      directory: "oxide/plugins",
    });
  });

  it("distingue Carbon d'Oxide", () => {
    expect(detect("Rust Carbon", "Rust")).toMatchObject({ directory: "carbon/plugins" });
  });

  it("rend null pour un jeu sans catalogue", () => {
    // `null` est un résultat légitime, pas une erreur : FiveM distribue ses
    // ressources hors de tout registre.
    expect(detect("FiveM", "Grand Theft Auto V")).toBeNull();
  });

  it("cherche aussi dans le nom du nest", () => {
    expect(detect("Serveur vanilla", "Rust")).toMatchObject({ loader: "oxide" });
  });

  it("reconnaît un serveur Minecraft officiel", () => {
    /*
     * Il n'était reconnu par aucune règle : `detectRuntime` rendait `null` et
     * l'écran « Moteur » restait vide — sur le serveur qui a le plus de
     * raisons d'en changer, puisqu'il n'accepte ni plugin ni mod.
     */
    expect(detect("Vanilla", "Minecraft")).toMatchObject({ game: "minecraft", loader: "any" });
    expect(detect("Minecraft Java", "Minecraft")).toMatchObject({ loader: "any" });
  });

  it("ne vole pas leur famille aux serveurs modifiés", () => {
    /*
     * « Minecraft » figure dans le nest de presque tous ces eggs : la règle
     * du serveur officiel est donc consultée en dernier. Posée plus haut, elle
     * aurait rendu « any » pour Paper comme pour Fabric, et le catalogue
     * d'extensions serait devenu vide pour tout le monde.
     */
    expect(detect("Paper", "Minecraft")).toMatchObject({ loader: "paper" });
    expect(detect("Fabric", "Minecraft")).toMatchObject({ loader: "fabric" });
    expect(detect("Velocity", "Minecraft")).toMatchObject({ loader: "velocity" });
  });
});

describe("version du jeu", () => {
  it("prend la variable renseignée", () => {
    expect(detect("Paper", "Minecraft", { MINECRAFT_VERSION: "1.21.4" })).toMatchObject({
      gameVersion: "1.21.4",
    });
  });

  it("essaie les variables dans l'ordre", () => {
    expect(detect("Paper", "Minecraft", { MC_VERSION: "1.20.6" })).toMatchObject({
      gameVersion: "1.20.6",
    });
  });

  it("traite « latest » comme aucune version", () => {
    // Comparer « latest » aux versions d'un catalogue ne donnerait jamais de
    // correspondance : le catalogue paraîtrait vide sans raison visible.
    expect(detect("Paper", "Minecraft", { MINECRAFT_VERSION: "latest" })).toMatchObject({
      gameVersion: "",
    });
  });

  it("ignore une variable vide", () => {
    expect(detect("Paper", "Minecraft", { MINECRAFT_VERSION: "  " })).toMatchObject({
      gameVersion: "",
    });
  });

  it("n'épingle pas de version pour Rust", () => {
    // Rust force une mise à jour mensuelle et les plugins suivent : épingler
    // rendrait le catalogue vide onze mois sur douze.
    expect(detect("Rust", "Rust", { RUST_VERSION: "2026.09" })).toMatchObject({ gameVersion: "" });
  });
});

/**
 * L'egg universel du panel ne nomme aucun chargeur : il les couvre tous, et
 * c'est ce qui permet d'en changer sans changer d'egg. Deviner d'après son nom
 * est donc impossible — la variable fait foi.
 */
describe("chargeur déclaré par l'egg", () => {
  it("lit LOADER plutôt que le nom de l'egg", () => {
    expect(detect("Minecraft Java", "Minecraft", { LOADER: "fabric" })).toMatchObject({
      loader: "fabric",
      directory: "mods",
    });
    expect(detect("Minecraft Java", "Minecraft", { LOADER: "paper" })).toMatchObject({
      loader: "paper",
      directory: "plugins",
    });
  });

  it("l'emporte sur un nom qui dirait le contraire", () => {
    // Un serveur repris d'un egg « Paper » puis basculé sur Forge porte encore
    // l'ancien nom dans certains parcs. Ce qui tourne est ce que dit la
    // variable, pas ce que dit l'étiquette.
    expect(detect("Paper", "Minecraft", { LOADER: "forge" })).toMatchObject({
      loader: "forge",
      directory: "mods",
    });
  });

  it("range NeoForge avec Forge et Quilt avec Fabric", () => {
    // Les catalogues ne connaissent pas ces deux étiquettes : chercher sous un
    // nom qu'aucun dépôt n'emploie rendrait une liste vide sans raison visible.
    expect(detect("Minecraft Java", "Minecraft", { LOADER: "neoforge" })).toMatchObject({
      loader: "forge",
    });
    expect(detect("Minecraft Java", "Minecraft", { LOADER: "quilt" })).toMatchObject({
      loader: "fabric",
    });
  });

  it("ne propose aucun catalogue à un serveur vanilla", () => {
    // Il n'accepte ni plugin ni mod : lui en proposer serait promettre des
    // extensions qui ne se chargeraient jamais.
    expect(detect("Minecraft Java", "Minecraft", { LOADER: "vanilla" })).toBeNull();
  });

  it("retombe sur le nom quand la variable ne dit rien", () => {
    expect(detect("Paper", "Minecraft", { LOADER: "  " })).toMatchObject({ loader: "paper" });
    expect(detect("Paper", "Minecraft", { LOADER: "inconnu" })).toMatchObject({ loader: "paper" });
  });
});
