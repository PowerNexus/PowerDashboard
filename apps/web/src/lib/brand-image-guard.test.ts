import { describe, expect, it } from "vitest";
import { afterSave, afterUpload, openGuard } from "./brand-image-guard";

/**
 * Garde des images de marque côté formulaire.
 *
 * Non-régression : le bandeau « image gardée » restait affiché après un nouvel
 * envoi de fichier, alors que cet envoi venait de remplacer l'image signalée.
 */
describe("garde des images de marque", () => {
  const ouvert = openGuard({ logoUrl: "https://a.fr/l.png", faviconUrl: "" });

  it("part de la valeur chargée, sans rien de gardé", () => {
    expect(ouvert).toEqual({ bases: { logoUrl: "https://a.fr/l.png", faviconUrl: "" }, kept: [] });
  });

  it("un enregistrement recale les bases et retient les champs gardés", () => {
    const garde = afterSave(ouvert, { logoUrl: "/brand/fichier/x" }, ["logoUrl"]);
    expect(garde).toEqual({
      bases: { logoUrl: "/brand/fichier/x", faviconUrl: "" },
      kept: ["logoUrl"],
    });
  });

  it("un envoi réussi fait de l'image la nouvelle base et efface le bandeau", () => {
    const garde = afterSave(ouvert, { logoUrl: "/brand/fichier/x" }, ["logoUrl"]);
    const envoi = afterUpload(garde, "faviconUrl", "/brand/fichier/y");
    expect(envoi.kept).toEqual([]);
    expect(envoi.bases).toEqual({ logoUrl: "/brand/fichier/x", faviconUrl: "/brand/fichier/y" });
  });
});
