import { execFileSync, spawnSync } from "node:child_process";
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
import { dirname, join } from "node:path";
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

/** Git sans configuration du poste : ni identité, ni réglage global. */
const GIT_ESSAI = {
  GIT_AUTHOR_NAME: "essai",
  GIT_AUTHOR_EMAIL: "essai@example.invalid",
  GIT_COMMITTER_NAME: "essai",
  GIT_COMMITTER_EMAIL: "essai@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(dossier: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "init.defaultBranch=main", "-C", dossier, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: dossier, ...GIT_ESSAI },
  }).trim();
}

describe("infra/cpanel/deployer.sh", () => {
  let travail: string;
  let racine: string;
  let github: string;
  let journalPnpm: string;
  let faux: string;

  /**
   * Pousse une construction sur `deploiement`, comme publier-construction.sh :
   * un commit sans parent qui remplace le précédent.
   */
  function publier(nom: string): string {
    const source = join(travail, "sources", nom);
    mkdirSync(join(source, "infra", "cpanel"), { recursive: true });
    writeFileSync(join(source, "RELEASE"), `version=v0.0.0-continu.${nom}\ncommit=${nom}\n`);
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

    git(source, "init", "-q");
    git(source, "add", "-A");
    git(source, "commit", "-q", "-m", `Construction ${nom}`);
    git(source, "push", "-q", "--force", github, "HEAD:refs/heads/deploiement");
    return git(source, "rev-parse", "HEAD");
  }

  function deployer() {
    return spawnSync("bash", [join(CPANEL, "deployer.sh")], {
      encoding: "utf8",
      // Un environnement réduit : celui du lanceur de tests porte parfois une
      // DATABASE_URL, qui fausserait ce que voit pnpm.
      env: {
        HOME: travail,
        PATH: `${faux}:${process.env.PATH ?? ""}`,
        GIT_CONFIG_NOSYSTEM: "1",
        GAMEDASHBOARD_RACINE: racine,
        GAMEDASHBOARD_DEPOT: github,
        GAMEDASHBOARD_NODE: join(faux, "node"),
        GAMEDASHBOARD_PNPM: "faux",
      },
    });
  }

  beforeEach(() => {
    travail = mkdtempSync(join(tmpdir(), "gd-cpanel-"));
    racine = join(travail, "gamedashboard");
    github = join(travail, "github.git");
    faux = join(travail, "faux");
    journalPnpm = join(travail, "pnpm.log");

    // GitHub : main porte le code, `deploiement` les constructions.
    mkdirSync(github);
    git(github, "init", "-q", "--bare");
    const code = join(travail, "code");
    mkdirSync(code);
    writeFileSync(join(code, "README.md"), "code source\n");
    git(code, "init", "-q");
    git(code, "add", "-A");
    git(code, "commit", "-q", "-m", "main");
    git(code, "push", "-q", github, "HEAD:refs/heads/main");

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
    const commit = publier("abc123");
    const passage = deployer();
    expect(passage.stderr).toBe("");
    expect(passage.status).toBe(0);

    const id = commit.slice(0, 12);
    expect(readlinkSync(join(racine, "actuelle"))).toBe(`versions/${id}`);
    expect(readFileSync(join(racine, "actuelle", ".commit"), "utf8").trim()).toBe(commit);

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

  it("reprend le clone de « Git Version Control » et le met sur la construction en service", () => {
    // cPanel clone la branche par défaut : main.
    git(travail, "clone", "-q", github, join(racine, "depot"));
    const commit = publier("abc123");
    expect(deployer().status).toBe(0);

    const depot = join(racine, "depot");
    expect(git(depot, "rev-parse", "--abbrev-ref", "HEAD")).toBe("deploiement");
    expect(git(depot, "rev-parse", "HEAD")).toBe(commit);
    expect(git(depot, "status", "--porcelain")).toBe("");
    expect(existsSync(join(depot, "README.md"))).toBe(false);
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

  it("suit la branche remplacée, et efface du clone les constructions remplacées", () => {
    const premiere = publier("abc123");
    deployer();
    const seconde = publier("def456");
    expect(deployer().status).toBe(0);

    expect(readlinkSync(join(racine, "actuelle"))).toBe(`versions/${seconde.slice(0, 12)}`);
    const reste = spawnSync("git", ["-C", join(racine, "depot"), "cat-file", "-e", premiere]);
    expect(reste.status).not.toBe(0);
  });

  it("ne clone ni ne télécharge rien tant que les réglages manquent", () => {
    rmSync(join(racine, "env", "web.env"));
    publier("abc123");
    const passage = deployer();
    expect(passage.status).toBe(1);
    expect(passage.stdout).toContain("Réglages absents");
    expect(existsSync(join(racine, "depot"))).toBe(false);
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
    const ids = ["a1", "b2", "c3", "d4"].map((nom) => {
      const commit = publier(nom);
      expect(deployer().status).toBe(0);
      return commit.slice(0, 12);
    });
    const restantes = execFileSync("ls", [join(racine, "versions")], { encoding: "utf8" })
      .trim()
      .split("\n")
      .sort();
    expect(restantes).toEqual(ids.slice(1).sort());
  });
});

describe("infra/cpanel/publier-construction.sh", () => {
  let travail: string;
  let projet: string;
  let github: string;

  function publierConstruction() {
    return spawnSync("bash", ["infra/cpanel/publier-construction.sh", "origin", "deploiement"], {
      cwd: projet,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: travail, ...GIT_ESSAI },
    });
  }

  beforeEach(() => {
    travail = mkdtempSync(join(tmpdir(), "gd-publier-"));
    projet = join(travail, "projet");
    github = join(travail, "github.git");
    mkdirSync(github);
    git(github, "init", "-q", "--bare");

    // Un dépôt réduit à ce que l'assemblage lit, workflows compris.
    for (const [chemin, contenu] of [
      [".gitignore", ".next/\n"],
      ["package.json", '{ "packageManager": "pnpm@11.20.0" }\n'],
      ["apps/web/package.json", '{ "name": "@gamedashboard/web" }\n'],
      [".github/workflows/ci.yml", "name: CI\n"],
      ["infra/prod/installer-wings.sh", "#!/bin/sh\n"],
      ["infra/prod/app.sh", "#!/bin/sh\n"],
    ] as const) {
      mkdirSync(dirname(join(projet, chemin)), { recursive: true });
      writeFileSync(join(projet, chemin), contenu);
    }
    for (const chemin of ["infra/release/assembler.sh", "infra/cpanel/publier-construction.sh"]) {
      mkdirSync(dirname(join(projet, chemin)), { recursive: true });
      copyFileSync(join(RACINE_DEPOT, chemin), join(projet, chemin));
    }
    git(projet, "init", "-q");
    git(projet, "add", "-A");
    git(projet, "commit", "-q", "-m", "code");
    git(projet, "remote", "add", "origin", github);

    // Une construction de production, cache et dossier de développement compris.
    const next = join(projet, "apps", "web", ".next");
    for (const chemin of [
      "BUILD_ID",
      "prerender-manifest.json",
      "server/page.js",
      "cache/lourd",
      "dev/lourd",
    ]) {
      mkdirSync(dirname(join(next, chemin)), { recursive: true });
      writeFileSync(join(next, chemin), chemin === "BUILD_ID" ? "construction-1" : "{}");
    }
  });

  afterEach(() => {
    rmSync(travail, { recursive: true, force: true });
  });

  it("pousse le code et l'interface construite, sans cache ni workflows", () => {
    const passage = publierConstruction();
    expect(passage.stderr).not.toContain("fatal");
    expect(passage.status).toBe(0);

    const fichiers = git(github, "ls-tree", "-r", "--name-only", "deploiement").split("\n");
    expect(fichiers).toEqual(
      expect.arrayContaining([
        "RELEASE",
        "package.json",
        "infra/cpanel/publier-construction.sh",
        "apps/web/.next/BUILD_ID",
        "apps/web/.next/server/page.js",
      ]),
    );
    expect(fichiers.filter((f) => /^\.github\/|\.next\/(cache|dev)\//.test(f))).toEqual([]);
    expect(git(github, "show", "deploiement:RELEASE")).toContain(
      `commit=${git(projet, "rev-parse", "HEAD")}`,
    );
  });

  it("remplace la construction précédente au lieu de s'y ajouter, sans toucher au dépôt", () => {
    publierConstruction();
    writeFileSync(join(projet, "apps", "web", ".next", "BUILD_ID"), "construction-2");
    expect(publierConstruction().status).toBe(0);

    // Un seul commit, sans parent : la branche ne grossit pas.
    expect(git(github, "rev-list", "--count", "deploiement")).toBe("1");
    expect(git(github, "show", "deploiement:apps/web/.next/BUILD_ID")).toBe("construction-2");
    expect(git(projet, "status", "--porcelain")).toBe("");
    expect(git(projet, "rev-list", "--count", "HEAD")).toBe("1");
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

  it("publie sur la branche que deployer.sh suit", () => {
    const script = readFileSync(join(CPANEL, "deployer.sh"), "utf8");
    expect(workflow).toContain("run: bash infra/cpanel/publier-construction.sh origin deploiement");
    expect(script).toContain("GAMEDASHBOARD_BRANCHE:-deploiement}");
    expect(script).toContain("raw.githubusercontent.com/PowerNexus/PowerDashboard/deploiement/");
  });
});
