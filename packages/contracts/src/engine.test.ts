import { describe, expect, it } from "vitest";
import {
  javaMajorFor,
  overwritesServerFiles,
  packFitsServer,
  packLoaderOf,
  pickDockerImage,
} from "./engine";

/**
 * Relevé sur un vrai serveur : un jar Paper 1.21 posé sur un egg réglé en
 * Java 8 donne un fichier parfaitement en place et un conteneur qui sort en
 * code 1 — « Minecraft requires running the server with Java 17 or above ».
 * Changer le moteur sans changer le runtime ne change rien d'utile.
 */
describe("javaMajorFor", () => {
  it("suit les trois seuils que Mojang a relevés", () => {
    expect(javaMajorFor("1.16.5")).toBe(8);
    expect(javaMajorFor("1.17.1")).toBe(16);
    expect(javaMajorFor("1.18.2")).toBe(17);
    expect(javaMajorFor("1.20.4")).toBe(17);
    expect(javaMajorFor("1.20.5")).toBe(21);
    expect(javaMajorFor("1.21.11")).toBe(21);
  });

  it("exige Java 25 sur les versions calendaires", () => {
    /*
     * Relevé sur un vrai serveur : « Minecraft 26.1 and newer requires running
     * the server with Java 25 or above ». Mojang a relevé le seuil une
     * quatrième fois en changeant de numérotation ; supposer qu'une version
     * calendaire se contente du Java de 1.21 poserait un jar qui refuse de
     * démarrer.
     */
    expect(javaMajorFor("26.1")).toBe(25);
    expect(javaMajorFor("26.3")).toBe(25);
  });

  it("ne devine pas sur une version illisible", () => {
    // Basculer l'image sur une supposition corrigerait un problème que le
    // serveur n'avait peut-être pas.
    expect(javaMajorFor("latest")).toBe(null);
    expect(javaMajorFor("")).toBe(null);
  });
});

describe("pickDockerImage", () => {
  const images = {
    "Java 8": "ghcr.io/ptero-eggs/yolks:java_8",
    "Java 17": "ghcr.io/ptero-eggs/yolks:java_17",
    "Java 21": "ghcr.io/ptero-eggs/yolks:java_21",
  };

  it("prend l'image exacte quand elle existe", () => {
    expect(pickDockerImage(images, 17)).toBe("ghcr.io/ptero-eggs/yolks:java_17");
  });

  it("remonte à la plus proche au-dessus, jamais en dessous", () => {
    // Java 21 fait tourner ce qui demande 17 ; l'inverse est faux.
    expect(pickDockerImage({ "Java 21": "a:java_21" }, 17)).toBe("a:java_21");
    expect(pickDockerImage({ "Java 8": "a:java_8" }, 17)).toBe(null);
  });

  it("n'invente jamais d'image", () => {
    // Un egg déclare les images sur lesquelles son auteur l'a éprouvé. En
    // fabriquer une ferait tirer au daemon une adresse qui n'existe pas.
    expect(pickDockerImage({}, 21)).toBe(null);
    expect(pickDockerImage({ Debian: "ghcr.io/x/debian:latest" }, 21)).toBe(null);
  });

  it("lit le numéro dans l'étiquette comme dans l'adresse", () => {
    expect(pickDockerImage({ "": "ghcr.io/x/yolks:java_21" }, 21)).toBe("ghcr.io/x/yolks:java_21");
    expect(pickDockerImage({ "Java 21": "ghcr.io/x/custom" }, 21)).toBe("ghcr.io/x/custom");
  });
});

describe("overwritesServerFiles", () => {
  it("distingue le jar du modpack", () => {
    // Un jar remplace un fichier ; un modpack déverse une arborescence. La
    // différence doit être dite avant de cliquer, pas découverte après.
    expect(overwritesServerFiles("jar")).toBe(false);
    expect(overwritesServerFiles("pack")).toBe(true);
  });
});

describe("chargeur d'un modpack", () => {
  it("lit le vocabulaire des deux catalogues", () => {
    expect(packLoaderOf("forge-47.2.0")).toEqual({ loader: "forge", version: "47.2.0" });
    expect(packLoaderOf("neoforge-21.1.77")).toEqual({ loader: "neoforge", version: "21.1.77" });
    // Régression : « fabric » était reconnu avant « fabric-loader », et la
    // version lue valait « loader-0.16.10 », introuvable chez Fabric.
    expect(packLoaderOf("fabric-loader-0.16.10")).toEqual({ loader: "fabric", version: "0.16.10" });
    expect(packLoaderOf("fabric-0.15.11")).toEqual({ loader: "fabric", version: "0.15.11" });
    expect(packLoaderOf("NeoForge")).toEqual({ loader: "neoforge", version: "" });
    expect(packLoaderOf("1.20.1")).toBeNull();
    expect(packLoaderOf("liteloader")).toBeNull();
  });

  it("ne pose un pack que sur un serveur du même chargeur", () => {
    expect(packFitsServer("fabric", "fabric")).toBe(true);
    expect(packFitsServer("neoforge", "forge")).toBe(true);
    expect(packFitsServer("forge", "fabric")).toBe(false);
    expect(packFitsServer("fabric", "forge")).toBe(false);
    expect(packFitsServer("quilt", "fabric")).toBe(false);
    expect(packFitsServer("fabric", "paper")).toBe(false);
  });
});
