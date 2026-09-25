import { describe, expect, it } from "vitest";
import { appartientAuServeur, cheminSur, dossiersDe, planifier, suiviApres } from "./pack-files";

describe("chemins venus d'une archive", () => {
  it("refuse ce qui remonte, part de la racine ou vise le dossier de travail", () => {
    expect(cheminSur("mods/sodium.jar")).toBe(true);
    expect(cheminSur("config/a b/c.toml")).toBe(true);
    for (const refuse of [
      "",
      "../etc/passwd",
      "mods/../../x",
      "/etc/passwd",
      "a//b",
      "a/./b",
      "c:\\windows",
      ".gamedashboard-pack/x",
      "nul\u0000.jar",
    ]) {
      expect(cheminSur(refuse), refuse).toBe(false);
    }
  });

  it("tient les mondes, les listes de joueurs et server.properties pour le serveur", () => {
    expect(appartientAuServeur("world/level.dat")).toBe(true);
    expect(appartientAuServeur("world_nether/DIM-1/r.0.0.mca")).toBe(true);
    expect(appartientAuServeur("server.properties")).toBe(true);
    expect(appartientAuServeur("ops.json")).toBe(true);
    expect(appartientAuServeur("config/server.properties")).toBe(false);
    expect(appartientAuServeur("mods/worldedit.jar")).toBe(false);
  });

  it("laisse au pack les datapacks posés à même le dossier datapacks d'un monde", () => {
    expect(appartientAuServeur("world/datapacks/recettes.zip")).toBe(false);
    expect(appartientAuServeur("world/datapacks/recettes/data/x.json")).toBe(true);
    expect(appartientAuServeur("world/level.dat")).toBe(true);
    expect(appartientAuServeur("logs/datapacks/x.zip")).toBe(true);
  });

  it("regroupe les chemins par dossier, racine comprise", () => {
    expect(dossiersDe(["a.txt", "mods/x.jar", "mods/y.jar", "config/m/z.toml"])).toEqual([
      "",
      "config/m",
      "mods",
    ]);
  });
});

describe("plan d'une installation de modpack", () => {
  it("première installation : écrit tout, sauf ce qui appartient déjà au serveur", () => {
    const plan = planifier({}, { "server.properties": "10:t0", "config/a.toml": "5:t0" }, [
      "mods/a.jar",
      "config/a.toml",
      "server.properties",
      "world/level.dat",
    ]);
    expect(plan.ecrire.sort()).toEqual(["config/a.toml", "mods/a.jar", "world/level.dat"]);
    expect(plan.garder).toEqual(["server.properties"]);
    expect(plan.retirer).toEqual([]);
  });

  it("mise à jour : remplace l'inchangé, garde le modifié, retire l'ancien", () => {
    const precedent = {
      "mods/a-1.jar": "100:t1",
      "config/a.toml": "5:t1",
      "config/b.toml": "7:t1",
      "config/vieux.toml": "3:t1",
      "config/retouche.toml": "3:t1",
    };
    const surDisque = {
      "mods/a-1.jar": "100:t1",
      "config/a.toml": "5:t1",
      // Modifié par l'utilisateur depuis : taille et date ont changé.
      "config/b.toml": "9:t7",
      "config/vieux.toml": "3:t1",
      "config/retouche.toml": "4:t8",
    };
    const plan = planifier(precedent, surDisque, [
      "mods/a-2.jar",
      "config/a.toml",
      "config/b.toml",
    ]);

    expect(plan.ecrire.sort()).toEqual(["config/a.toml", "mods/a-2.jar"]);
    expect(plan.garder).toEqual(["config/b.toml"]);
    // L'ancien jar part même s'il avait « changé » : deux versions d'un mod
    // côte à côte empêchent le serveur de démarrer.
    expect(plan.retirer.sort()).toEqual(["config/vieux.toml", "mods/a-1.jar"]);
    expect(plan.laisser).toEqual(["config/retouche.toml"]);
  });

  it("un jar est toujours remplacé, même si son empreinte a bougé", () => {
    const plan = planifier({ "mods/a.jar": "1:t1" }, { "mods/a.jar": "2:t2" }, ["mods/a.jar"]);
    expect(plan.ecrire).toEqual(["mods/a.jar"]);
  });

  it("le suivi garde l'ancienne empreinte d'un fichier gardé, pour le garder encore", () => {
    const precedent = { "config/b.toml": "7:t1", "server.properties": "1:t1" };
    const plan = planifier(precedent, { "config/b.toml": "9:t7", "server.properties": "2:t2" }, [
      "config/b.toml",
      "server.properties",
      "mods/x.jar",
    ]);
    const suivi = suiviApres(precedent, plan, { "mods/x.jar": "50:t9" });
    expect(suivi).toEqual({ "config/b.toml": "7:t1", "mods/x.jar": "50:t9" });
  });
});
