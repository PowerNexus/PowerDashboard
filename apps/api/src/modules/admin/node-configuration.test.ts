import { describe, expect, it } from "vitest";
import { toYaml } from "./node-configuration.service";

describe("sérialisation de la configuration de Wings", () => {
  it("met toutes les chaînes entre apostrophes", () => {
    /*
     * C'est la raison d'être de cette fonction. Sans guillemets, un nom de
     * marque valant « oui » deviendrait un booléen, un jeton commençant par un
     * chiffre un nombre, et le daemon refuserait sa propre configuration.
     */
    expect(toYaml({ app_name: "oui", token: "1234abcd" })).toBe(
      "app_name: 'oui'\ntoken: '1234abcd'\n",
    );
  });

  it("laisse les nombres et les booléens nus", () => {
    expect(toYaml({ port: 8080, debug: false })).toBe("port: 8080\ndebug: false\n");
  });

  it("double l'apostrophe à l'intérieur d'une chaîne", () => {
    // Seul échappement que connaisse ce style de chaîne, et il suffit.
    expect(toYaml({ name: "L'hôte" })).toBe("name: 'L''hôte'\n");
  });

  it("imbrique les objets avec deux espaces par niveau", () => {
    expect(toYaml({ api: { ssl: { enabled: true } } })).toBe("api:\n  ssl:\n    enabled: true\n");
  });

  it("écrit une liste vide en ligne", () => {
    // Deux lignes sans élément donneraient une clé nulle, que Wings lirait
    // comme « aucune valeur » et non « aucun élément ».
    expect(toYaml({ allowed_mounts: [] })).toBe("allowed_mounts: []\n");
  });

  it("écrit une liste de chemins, chacun entre apostrophes", () => {
    expect(toYaml({ allowed_mounts: ["/srv/cartes", "/srv/data"] })).toBe(
      "allowed_mounts:\n  - '/srv/cartes'\n  - '/srv/data'\n",
    );
  });
});
