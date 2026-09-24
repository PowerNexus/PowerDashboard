import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Hébergement cPanel (`docs/hebergement-cpanel.md`) : ce que nginx et
 * `deploy.sh` font sur un serveur à soi, refait sans eux.
 */

const RACINE_DEPOT = join(import.meta.dirname, "..", "..", "..", "..");
const CPANEL = join(RACINE_DEPOT, "infra", "cpanel");
const { normaliserEntetes } = createRequire(import.meta.url)(join(CPANEL, "entetes.cjs")) as {
  normaliserEntetes: (entetes: Record<string, string | undefined>) => void;
};

describe("infra/cpanel/entetes.cjs", () => {
  it("ne garde de X-Forwarded-For que l'adresse vue par Passenger", () => {
    // Passenger ajoute l'adresse réelle à la chaîne du visiteur, sans l'effacer.
    const entetes: Record<string, string | undefined> = {
      host: "panel.example.fr",
      "x-forwarded-for": "6.6.6.6, 203.0.113.9",
      "!~passenger-client-address": "203.0.113.9",
      "!~passenger-proto": "https",
    };
    normaliserEntetes(entetes);
    expect(entetes["x-forwarded-for"]).toBe("203.0.113.9");
    expect(entetes["x-forwarded-proto"]).toBe("https");
  });

  it("réécrit X-Forwarded-Host : le domaine des liens envoyés ne se choisit pas", () => {
    const entetes: Record<string, string | undefined> = {
      host: "panel.example.fr",
      "x-forwarded-host": "piege.example",
      "x-forwarded-proto": "https",
    };
    normaliserEntetes(entetes);
    expect(entetes["x-forwarded-host"]).toBe("panel.example.fr");
    // Sans Passenger pour l'affirmer, la requête n'est pas réputée chiffrée.
    expect(entetes["x-forwarded-proto"]).toBe("http");
    expect(entetes["x-forwarded-for"]).toBeUndefined();
  });

  it("efface le pays annoncé et les en-têtes internes de Passenger", () => {
    const entetes: Record<string, string | undefined> = {
      host: "panel.example.fr",
      "cf-ipcountry": "FR",
      "!~passenger-client-address": "203.0.113.9",
      "!~passenger-envvars": "secret",
    };
    normaliserEntetes(entetes);
    expect(entetes["cf-ipcountry"]).toBeUndefined();
    expect(Object.keys(entetes).filter((nom) => nom.startsWith("!~"))).toEqual([]);
  });
});

/**
 * Le lanceur : seul fichier fixe de l'hébergement, qui choisit la version à
 * démarrer et revient à la précédente quand une nouvelle ne tient pas.
 */
describe("infra/cpanel/lanceur.cjs", () => {
  const { comparerVersions } = createRequire(import.meta.url)(join(CPANEL, "lanceur.cjs")) as {
    comparerVersions: (a: string, b: string) => number;
  };
  let racine: string;

  /** Une version dont le démarrage écrit son nom dans `demarree`, ou échoue. */
  function installer(version: string, { casse = false } = {}) {
    const demarrage = join(racine, "versions", version, "demarrage");
    mkdirSync(demarrage, { recursive: true });
    for (const role of ["api", "interface"]) {
      writeFileSync(
        join(demarrage, `${role}.cjs`),
        casse
          ? 'throw new Error("module introuvable");\n'
          : `require("node:fs").appendFileSync(${JSON.stringify(join(racine, "demarree"))}, "${version}:${role}\\n");\n`,
      );
    }
  }

  function demarrer(role: "api" | "interface") {
    return spawnSync(
      process.execPath,
      [
        "-e",
        `require(${JSON.stringify(join(CPANEL, "lanceur.cjs"))}).lancer("${role}", process.argv[1])`,
        racine,
      ],
      { encoding: "utf8" },
    );
  }

  const etat = () => JSON.parse(readFileSync(join(racine, "etat.json"), "utf8"));
  const demarrees = () => readFileSync(join(racine, "demarree"), "utf8").trim().split("\n");

  beforeEach(() => {
    racine = mkdtempSync(join(tmpdir(), "gd-lanceur-"));
  });
  afterEach(() => {
    rmSync(racine, { recursive: true, force: true });
  });

  it("démarre, à la première installation, la plus haute version extraite", () => {
    installer("v1.9.0");
    installer("v1.10.0");
    installer("v1.10.0-rc.1");
    expect(demarrer("api").status).toBe(0);
    expect(demarrees()).toEqual(["v1.10.0:api"]);
  });

  it("démarre la version que désigne etat.json, pas la plus récente", () => {
    installer("v1.0.0");
    installer("v1.1.0");
    writeFileSync(join(racine, "etat.json"), JSON.stringify({ enService: "v1.0.0" }));
    expect(demarrer("interface").status).toBe(0);
    expect(demarrees()).toEqual(["v1.0.0:interface"]);
  });

  it("revient à la précédente quand la nouvelle ne confirme pas son démarrage", () => {
    installer("v1.0.0");
    installer("v1.1.0");
    writeFileSync(
      join(racine, "etat.json"),
      JSON.stringify({
        enService: "v1.1.0",
        precedente: "v1.0.0",
        bascule: { version: "v1.1.0", depuis: new Date().toISOString(), confirmee: false },
      }),
    );

    // Trois démarrages sont laissés à la nouvelle version…
    for (let i = 0; i < 3; i++) expect(demarrer("api").status).toBe(0);
    expect(etat().enService).toBe("v1.1.0");
    expect(etat().bascule.demarrages).toBe(3);

    // … le quatrième revient à la précédente, et relance l'interface avec elle.
    expect(demarrer("api").status).toBe(0);
    expect(demarrees().at(-1)).toBe("v1.0.0:api");
    expect(etat()).toMatchObject({
      enService: "v1.0.0",
      bascule: null,
      refusees: ["v1.1.0"],
      dernierResultat: { etat: "refusee", version: "v1.1.0" },
    });
    expect(existsSync(join(racine, "passenger", "interface", "tmp", "restart.txt"))).toBe(true);
  });

  it("revient à la précédente quand la version ne se charge même pas", () => {
    installer("v1.0.0");
    installer("v1.1.0", { casse: true });
    writeFileSync(
      join(racine, "etat.json"),
      JSON.stringify({ enService: "v1.1.0", precedente: "v1.0.0" }),
    );

    expect(demarrer("interface").status).toBe(0);
    expect(demarrees()).toEqual(["v1.0.0:interface"]);
    expect(etat()).toMatchObject({ enService: "v1.0.0", refusees: ["v1.1.0"] });
  });

  it("échoue franchement quand il n'y a rien vers quoi revenir", () => {
    installer("v1.0.0", { casse: true });
    const passage = demarrer("api");
    expect(passage.status).not.toBe(0);
    expect(passage.stderr).toContain("module introuvable");
  });

  it("ordonne les versions comme semver, préversions avant leur version", () => {
    const tri = ["v1.10.0", "v1.2.0", "v1.10.0-rc.2", "v1.10.0-rc.1", "v0.9.9"].sort(
      comparerVersions,
    );
    expect(tri).toEqual(["v0.9.9", "v1.2.0", "v1.10.0-rc.1", "v1.10.0-rc.2", "v1.10.0"]);
  });
});
