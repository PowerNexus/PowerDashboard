import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

describe("infra/cpanel/deployer.sh", () => {
  let travail: string;
  let racine: string;
  let publication: string;
  let journalPnpm: string;
  let faux: string;

  /** Publie une archive comme le fait deploiement.yml, sous un nom fixe. */
  function publier(commit: string, { empreinteFausse = false } = {}): string {
    const nom = `gamedashboard-v0.0.0-continu.${commit}`;
    const source = join(travail, "sources", nom);
    mkdirSync(join(source, "infra", "cpanel"), { recursive: true });
    writeFileSync(join(source, "RELEASE"), `version=v0.0.0-continu.${commit}\ncommit=${commit}\n`);
    writeFileSync(join(source, "package.json"), '{ "packageManager": "pnpm@11.20.0" }\n');
    copyFileSync(
      join(CPANEL, "emplacements.cjs"),
      join(source, "infra", "cpanel", "emplacements.cjs"),
    );
    // À la place du vrai démarrage : dire où il se croit.
    const sonde =
      'process.stdout.write(JSON.stringify(require("./emplacements.cjs").emplacements()));\n';
    writeFileSync(join(source, "infra", "cpanel", "api.cjs"), sonde);
    writeFileSync(join(source, "infra", "cpanel", "interface.cjs"), sonde);

    const archive = join(publication, "gamedashboard.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", join(travail, "sources"), nom]);
    const empreinte = empreinteFausse
      ? "0".repeat(64)
      : createHash("sha256").update(readFileSync(archive)).digest("hex");
    writeFileSync(`${archive}.sha256`, `${empreinte}  gamedashboard.tar.gz\n`);
    return empreinte;
  }

  function deployer() {
    return spawnSync("bash", [join(CPANEL, "deployer.sh")], {
      encoding: "utf8",
      // Un environnement réduit : celui du lanceur de tests porte parfois une
      // DATABASE_URL, qui fausserait ce que voit pnpm.
      env: {
        HOME: travail,
        PATH: `${faux}:${process.env.PATH ?? ""}`,
        GAMEDASHBOARD_RACINE: racine,
        GAMEDASHBOARD_SOURCE: `file://${publication}`,
        GAMEDASHBOARD_NODE: join(faux, "node"),
        GAMEDASHBOARD_PNPM: "faux",
      },
    });
  }

  beforeEach(() => {
    travail = mkdtempSync(join(tmpdir(), "gd-cpanel-"));
    racine = join(travail, "gamedashboard");
    publication = join(travail, "publication");
    faux = join(travail, "faux");
    journalPnpm = join(travail, "pnpm.log");
    mkdirSync(publication);
    mkdirSync(faux);
    // Un pnpm qui ne fait que noter ce qu'on lui demande, et ce qu'il voit.
    writeFileSync(
      join(faux, "pnpm"),
      `#!/bin/sh\necho "$* | base=\${DATABASE_URL:-} | cle=\${APP_SECRET_KEY:-}" >> "${journalPnpm}"\n`,
    );
    chmodSync(join(faux, "pnpm"), 0o755);
    // Node seul dans son dossier : celui du lanceur a parfois un pnpm à côté,
    // qui passerait devant le faux.
    mkdirSync(join(faux, "node"));
    symlinkSync(process.execPath, join(faux, "node", "node"));
    mkdirSync(join(racine, "env"), { recursive: true });
    writeFileSync(join(racine, "env", "web.env"), "API_URL=https://api.example.fr\n");
    writeFileSync(
      join(racine, "env", "api.env"),
      "DATABASE_URL=postgres://gd:mdp@localhost/gd\nAPP_SECRET_KEY=ne-doit-pas-sortir\n",
    );
  });

  afterEach(() => {
    rmSync(travail, { recursive: true, force: true });
  });

  it("installe, migre, bascule et prépare les deux applications Passenger", () => {
    const empreinte = publier("abc123");
    const passage = deployer();
    expect(passage.stderr).toBe("");
    expect(passage.status).toBe(0);

    const id = empreinte.slice(0, 12);
    expect(readlinkSync(join(racine, "actuelle"))).toBe(`versions/${id}`);
    expect(readFileSync(join(racine, "actuelle", ".empreinte"), "utf8").trim()).toBe(empreinte);

    const appels = readFileSync(journalPnpm, "utf8").trim().split("\n");
    expect(appels[0]).toMatch(/^install --frozen-lockfile \| base= \| cle=$/);
    // La migration reçoit la base, jamais la clé de chiffrement.
    expect(appels[1]).toBe(
      "--filter @gamedashboard/db db:migrate | base=postgres://gd:mdp@localhost/gd | cle=",
    );

    for (const nom of ["api", "interface"]) {
      expect(existsSync(join(racine, "passenger", nom, "tmp", "restart.txt"))).toBe(true);
      // Le relais de la racine d'application arrive dans la version active,
      // et celle-ci se sait dans ses vrais dossiers, lien suivi.
      const sortie = execFileSync(process.execPath, [join(racine, "passenger", nom, "app.cjs")], {
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "" },
      });
      expect(JSON.parse(sortie)).toEqual({
        application: realpathSync(join(racine, "versions", id)),
        racine: realpathSync(racine),
      });
    }
  });

  it("ne refait rien quand la construction publiée est déjà en service", () => {
    publier("abc123");
    deployer();
    const avant = readFileSync(journalPnpm, "utf8");

    const passage = deployer();
    expect(passage.status).toBe(0);
    expect(passage.stdout).toBe("");
    expect(readFileSync(journalPnpm, "utf8")).toBe(avant);
  });

  it("refuse une archive dont l'empreinte ne correspond pas, sans toucher à la version en service", () => {
    const bonne = publier("abc123");
    deployer();

    publier("def456", { empreinteFausse: true });
    const passage = deployer();
    expect(passage.status).toBe(1);
    expect(passage.stdout).toContain("Empreinte différente");
    expect(readlinkSync(join(racine, "actuelle"))).toBe(`versions/${bonne.slice(0, 12)}`);
  });

  it("ne télécharge rien tant que les réglages manquent", () => {
    rmSync(join(racine, "env", "web.env"));
    publier("abc123");
    const passage = deployer();
    expect(passage.status).toBe(1);
    expect(passage.stdout).toContain("Réglages absents");
    expect(existsSync(join(racine, "versions"))).toBe(true);
    expect(execFileSync("ls", ["-A", join(racine, "versions")], { encoding: "utf8" })).toBe("");
  });

  it("ne bascule pas quand la base n'est pas réglée", () => {
    writeFileSync(join(racine, "env", "api.env"), "APP_SECRET_KEY=x\n");
    publier("abc123");
    const passage = deployer();
    expect(passage.status).toBe(1);
    expect(passage.stdout).toContain("DATABASE_URL absent");
    expect(existsSync(join(racine, "actuelle"))).toBe(false);
  });

  it("garde la version en service et les deux précédentes, pas plus", () => {
    const empreintes = ["a1", "b2", "c3", "d4"].map((commit) => {
      const empreinte = publier(commit);
      expect(deployer().status).toBe(0);
      return empreinte.slice(0, 12);
    });
    const restantes = execFileSync("ls", [join(racine, "versions")], { encoding: "utf8" })
      .trim()
      .split("\n")
      .sort();
    expect(restantes).toEqual(empreintes.slice(1).sort());
  });
});

describe(".github/workflows/deploiement.yml", () => {
  const workflow = readFileSync(
    join(RACINE_DEPOT, ".github", "workflows", "deploiement.yml"),
    "utf8",
  );

  it("ne publie que ce que la CI a vérifié sur main, jamais le code d'une PR", () => {
    expect(workflow).toMatch(
      /workflow_run:\n\s+workflows: \[CI\]\n\s+types: \[completed\]\n\s+branches: \[main\]/,
    );
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain("github.event.workflow_run.event == 'push'");
    expect(workflow).toContain(`COMMIT: \${{ github.event.workflow_run.head_sha || github.sha }}`);
  });

  it("publie l'archive avant son empreinte, et jamais comme « la dernière » version", () => {
    const archive = workflow.indexOf("upload continu publication/gamedashboard.tar.gz --clobber");
    const empreinte = workflow.indexOf(
      "upload continu publication/gamedashboard.tar.gz.sha256 --clobber",
    );
    expect(archive).toBeGreaterThan(0);
    expect(empreinte).toBeGreaterThan(archive);
    expect(workflow).toContain("--prerelease --latest=false");
  });

  it("publie sous les noms que deployer.sh vient chercher", () => {
    const script = readFileSync(join(CPANEL, "deployer.sh"), "utf8");
    expect(script).toContain("releases/download/continu");
    for (const fichier of ["gamedashboard.tar.gz", "gamedashboard.tar.gz.sha256"]) {
      expect(script).toContain(`$source/${fichier}`);
      expect(workflow).toContain(`publication/${fichier}`);
    }
  });
});
