import { describe, expect, it } from "vitest";
import { splitUsername, toWingsPermissions } from "./sftp-auth.service";

describe("nom d'utilisateur SFTP", () => {
  it("coupe au dernier point, pas au premier", () => {
    // Une adresse e-mail contient des points : couper au premier donnerait
    // « matheo » pour « matheo.leduc@exemple.fr ».
    expect(splitUsername("matheo.leduc@exemple.fr.1a2b3c4d")).toEqual({
      label: "matheo.leduc@exemple.fr",
      shortId: "1a2b3c4d",
    });
  });

  it("accepte l'identifiant court quelle que soit sa casse", () => {
    expect(splitUsername("client@exemple.fr.1A2B3C4D")?.shortId).toBe("1a2b3c4d");
  });

  it("refuse ce qui n'a pas la forme imposée par le daemon", () => {
    // Pas de point, identifiant trop court, trop long, ou hors hexadécimal :
    // aucun ne peut désigner un serveur, et Wings les refuse déjà lui-même.
    for (const value of ["sanspoint", "a.1a2b3c", "a.1a2b3c4d5", "a.zzzzzzzz", ".1a2b3c4d"]) {
      expect(splitUsername(value), value).toBe(null);
    }
  });
});

describe("traduction des permissions pour Wings", () => {
  it("n'accorde rien sans le droit d'employer le SFTP", () => {
    /*
     * C'est ce droit qui ouvre la porte. Voir les fichiers dans le panel — qui
     * journalise chaque geste — et pouvoir les emporter par SFTP ne se donnent
     * pas au même monde.
     */
    expect(toWingsPermissions(["files.read", "files.write", "files.delete"])).toEqual([]);
  });

  it("donne les deux droits de lecture de Wings pour notre seul « files.read »", () => {
    // Wings distingue lister un dossier de lire un fichier ; le panel n'a qu'un
    // droit de lecture. N'en donner qu'un laisserait voir les noms sans jamais
    // pouvoir ouvrir quoi que ce soit.
    expect(toWingsPermissions(["files.sftp", "files.read"])).toEqual([
      "file.read",
      "file.read-content",
    ]);
  });

  it("traduit l'écriture en création et mise à jour", () => {
    expect(toWingsPermissions(["files.sftp", "files.write"])).toEqual([
      "file.create",
      "file.update",
    ]);
  });

  it("rend une liste vide quand le droit d'entrer est seul", () => {
    // Entrer sans pouvoir lire ni écrire n'est pas un accès : c'est une session
    // qui échoue à chaque commande. L'appelant traite donc ce cas en refus.
    expect(toWingsPermissions(["files.sftp"])).toEqual([]);
  });

  it("n'invente aucun droit à partir d'une permission voisine", () => {
    // `files.archive` autorise à fabriquer une archive depuis le panel, pas à
    // écrire des fichiers par SFTP.
    expect(toWingsPermissions(["files.sftp", "files.archive"])).toEqual([]);
  });
});
