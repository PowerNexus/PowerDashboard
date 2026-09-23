import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Le vhost de production doit démarrer sur une machine **neuve**.
 *
 * `panel.conf` a été écrit sur une machine partagée qui déclarait déjà, pour
 * d'autres sites, un `map $http_upgrade $req_connection` et un fichier
 * `snippets/tls/tls-intermediate.conf`. Il s'en servait sans les apporter :
 * sur toute autre machine, `nginx -t` refusait la configuration et
 * `deploy.sh` s'arrêtait à l'étape nginx — c'est-à-dire à la dernière, après
 * dix minutes de construction.
 *
 * Ce contrôle refuse une variable nginx qui ne soit ni native ni déclarée
 * dans le fichier, et un `include` que le dépôt ne livre pas.
 */

const RACINE = join(import.meta.dirname, "..", "..", "..", "..");
const PROD = join(RACINE, "infra", "prod");
const vhost = readFileSync(join(PROD, "panel.conf"), "utf8");
const deploy = readFileSync(join(PROD, "deploy.sh"), "utf8");

/** Sans les commentaires : ils citent l'ancien nom de variable, à dessein. */
const directives = vhost
  .split("\n")
  .map((ligne) => ligne.replace(/#.*$/, ""))
  .join("\n");

/** Les variables que nginx fournit lui-même, parmi celles que ce vhost lit. */
const NATIVES = new Set([
  "host",
  "request_uri",
  "remote_addr",
  "binary_remote_addr",
  "proxy_add_x_forwarded_for",
  "scheme",
  "http_upgrade",
]);

describe("infra/prod/panel.conf", () => {
  it("ne lit aucune variable déclarée ailleurs sur la machine", () => {
    const declarees = new Set(
      [...directives.matchAll(/^\s*map\s+\$\w+\s+\$(\w+)/gm)].map((m) => m[1] ?? ""),
    );
    const lues = new Set([...directives.matchAll(/\$(\w+)/g)].map((m) => m[1] ?? ""));
    const inconnues = [...lues].filter((v) => !NATIVES.has(v) && !declarees.has(v));
    expect(inconnues).toEqual([]);
  });

  it("ne déclare que des variables à son préfixe, pour ne heurter aucun autre vhost", () => {
    const declarees = [...directives.matchAll(/^\s*map\s+\$\w+\s+\$(\w+)/gm)].map(
      (m) => m[1] ?? "",
    );
    expect(declarees.length).toBeGreaterThan(0);
    for (const nom of declarees) expect(nom).toMatch(/^gd_/);
  });

  it("n'inclut que des fichiers que le dépôt livre et que deploy.sh pose", () => {
    const inclus = [...directives.matchAll(/^\s*include\s+([^;]+);/gm)].map((m) =>
      (m[1] ?? "").trim(),
    );
    expect(inclus.length).toBeGreaterThan(0);
    for (const chemin of inclus) {
      const nom = chemin.split("/").at(-1) ?? chemin;
      expect(existsSync(join(PROD, nom)), `${nom} manque dans infra/prod`).toBe(true);
      expect(deploy, `deploy.sh ne pose pas ${chemin}`).toContain(`/etc/nginx/${chemin}`);
    }
  });

  it("reste accepté par le nginx de Debian 12 et d'Ubuntu 24.04", () => {
    // `http2 on;` date de nginx 1.25.1 ; ces distributions livrent 1.22 et
    // 1.24. deploy.sh doit la réécrire en `listen … http2` pour elles.
    if (/^\s*http2 on;/m.test(directives)) {
      expect(deploy).toContain("1.25.1");
      expect(deploy).toContain("http2 on;");
    }
  });

  it("ne porte que le nom d'exemple, que deploy.sh remplace par le domaine réel", () => {
    const noms = [...directives.matchAll(/server_name\s+([^;]+);/g)].map((m) =>
      (m[1] ?? "").trim(),
    );
    expect(new Set(noms)).toEqual(new Set(["panel.example.fr"]));
    expect(deploy).toContain("EXEMPLE=panel.example.fr");
    expect(deploy).not.toMatch(/^DOMAIN=panel\.example\.fr$/m);
  });
});

/**
 * Le contrôle de fin de livraison reconnaît l'écran d'erreur à son titre.
 *
 * Chaque page embarque le catalogue de traductions, où ce titre figure en
 * JSON (`"genericTitle":"Une erreur est survenue"`). Cherché seul, il se
 * trouvait donc dans **toutes** les pages : chaque livraison était déclarée
 * en échec à sa dernière étape. Seul le texte rendu, entre deux balises,
 * désigne l'écran d'erreur.
 */
describe("contrôle des pages après livraison", () => {
  const catalogue = JSON.parse(
    readFileSync(join(RACINE, "packages", "i18n", "src", "messages", "fr.json"), "utf8"),
  ) as { errorPage: { genericTitle: string } };
  const titre = catalogue.errorPage.genericTitle;
  const scripts = {
    "infra/prod/deploy.sh": deploy,
    "infra/local/install.sh": readFileSync(join(RACINE, "infra", "local", "install.sh"), "utf8"),
  };

  for (const [chemin, contenu] of Object.entries(scripts)) {
    it(`${chemin} cherche le titre rendu, pas le texte du catalogue`, () => {
      const recherches = [...contenu.matchAll(/grep -q "([^"]*)" "\$corps"/g)].map(
        (m) => m[1] ?? "",
      );
      const surErreur = recherches.filter((motif) => motif.includes(titre));
      expect(surErreur).toEqual([`>${titre}<`]);
    });
  }
});

/**
 * Les commandes d'exploitation vivent sous `app:`.
 *
 * pnpm fait passer ses propres commandes avant les scripts du projet. Un
 * script `setup` n'était donc jamais lancé par `pnpm setup` : pnpm réglait à
 * la place son dossier global et modifiait le `.bashrc`, sans rien dire du
 * panel. `restart` enchaîne de même d'autres scripts au lieu de lancer le
 * sien.
 */
describe("commandes app: du package.json", () => {
  const paquet = JSON.parse(readFileSync(join(RACINE, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const app = readFileSync(join(PROD, "app.sh"), "utf8");

  /** Commandes de pnpm qui l'emportent sur un script du même nom. */
  const INTEGREES = [
    "add",
    "audit",
    "bin",
    "config",
    "create",
    "deploy",
    "dlx",
    "env",
    "exec",
    "fetch",
    "i",
    "import",
    "init",
    "install",
    "link",
    "list",
    "ls",
    "outdated",
    "pack",
    "patch",
    "prune",
    "publish",
    "rebuild",
    "remove",
    "restart",
    "rm",
    "root",
    "setup",
    "store",
    "unlink",
    "update",
    "why",
  ];

  it("aucun script ne porte le nom d'une commande de pnpm", () => {
    const captes = Object.keys(paquet.scripts).filter((nom) => INTEGREES.includes(nom));
    expect(captes).toEqual([]);
  });

  const commandes = Object.entries(paquet.scripts).filter(([nom]) => nom.startsWith("app:"));

  it("les commandes d'installation et de pilotage existent", () => {
    const noms = commandes.map(([nom]) => nom);
    for (const attendu of ["app:install", "app:setup", "app:start", "app:stop", "app:help"]) {
      expect(noms).toContain(attendu);
    }
  });

  for (const [nom, script] of commandes) {
    const action = nom.slice("app:".length);
    it(`${nom} passe par app.sh, qui la traite et la documente`, () => {
      expect(script).toBe(`bash infra/prod/app.sh ${action}`);
      expect(app).toMatch(new RegExp(`^\\s*${action}(\\s*\\|[^)]*)?\\)`, "m"));
      expect(app).toContain(`pnpm ${nom}`);
    });
  }
});

/**
 * La ligne de commande s'exécute sans le dépôt.
 *
 * `curl …/gamedashboard.sh | sudo bash -s -- install` lit app.sh seul, sans
 * dossier autour : tout fichier du dépôt qu'il lirait par un chemin relatif
 * manquerait. Il ne doit donc en atteindre qu'à travers un dossier qu'il a
 * lui-même résolu ou téléchargé — et il doit être publié à chaque version.
 */
describe("CLI autonome (gamedashboard.sh)", () => {
  const app = readFileSync(join(PROD, "app.sh"), "utf8");
  const code = app
    .split("\n")
    .filter((ligne) => !/^\s*#/.test(ligne))
    .join("\n");

  it("n'atteint un fichier du dépôt qu'à travers un dossier résolu", () => {
    const chemins = [...code.matchAll(/(\S*)\/?(infra\/[\w./-]+)/g)];
    expect(chemins.length).toBeGreaterThan(0);
    for (const [, prefixe] of chemins) {
      expect(prefixe).toMatch(/^"?\$(RACINE|DOSSIER|depuis)\/?$/);
    }
    expect(code).not.toMatch(/^\s*(source|\.)\s/m);
  });

  it("est publiée à chaque version, empreinte comprise, et attestée", () => {
    const assembler = readFileSync(join(RACINE, "infra", "release", "assembler.sh"), "utf8");
    expect(assembler).toContain('infra/prod/app.sh "$SORTIE/gamedashboard.sh"');
    expect(assembler).toContain("sha256sum gamedashboard.sh");
    const release = readFileSync(join(RACINE, ".github", "workflows", "release.yml"), "utf8");
    expect(release).toContain("dist/gamedashboard.sh");
  });

  it("vérifie l'empreinte de tout ce qu'elle télécharge", () => {
    // Tout fichier écrit par curl l'est dans telecharger(), qui vérifie
    // ensuite l'un par l'autre : le fichier et son empreinte.
    const ecrits = [...code.matchAll(/curl [^\n]*-o "([^"]+)"/g)].map((m) => m[1]);
    expect(ecrits).toEqual(["$dossier/$nom", "$dossier/$nom.sha256"]);
    expect(code).toContain('sha256sum -c --quiet "$nom.sha256"');
  });
});

/**
 * Le 19 mars 2026, 76 des 77 tags de `aquasecurity/trivy-action` ont été
 * réécrits vers un voleur de secrets (GHSA, correctif 0.35.0). Un tag se
 * réécrit, une empreinte de commit non : toute action tierce est épinglée
 * par empreinte, la version lisible reste en commentaire pour Renovate.
 */
describe("actions GitHub des workflows", () => {
  const dossier = join(RACINE, ".github", "workflows");
  const workflows = ["ci.yml", "release.yml"].map((nom) =>
    readFileSync(join(dossier, nom), "utf8"),
  );
  const actions = workflows.flatMap((texte) =>
    [...texte.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1] as string),
  );

  it("sont toutes épinglées par empreinte de commit", () => {
    const tierces = actions.filter((action) => !action.startsWith("./"));
    expect(tierces.length).toBeGreaterThan(0);
    for (const action of tierces) {
      expect(action).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    }
  });

  it("tournent sur le runner auto-hébergé, sauf choix contraire dans CI_RUNNER", () => {
    const cibles = workflows.flatMap((texte) =>
      [...texte.matchAll(/^\s*runs-on:\s*(.+)$/gm)].map((m) => m[1]),
    );
    expect(cibles.length).toBe(4);
    for (const cible of cibles) {
      expect(cible).toBe(`\${{ fromJSON(vars.CI_RUNNER || '["self-hosted","linux","x64"]') }}`);
    }
  });

  it("ne téléversent le cache pnpm que depuis un runner de GitHub", () => {
    const caches = workflows.flatMap((texte) =>
      [...texte.matchAll(/^\s*cache:\s*(.+)$/gm)].map((m) => m[1]),
    );
    expect(caches.length).toBe(4);
    for (const cache of caches) {
      expect(cache).toBe(`\${{ runner.environment == 'github-hosted' && 'pnpm' || '' }}`);
    }
  });

  it("ne tombent pas pour un quota d'artefacts atteint", () => {
    const envois = workflows.flatMap((texte) =>
      [...texte.matchAll(/^( +)- name: .+\n(?:\1 {2}.*\n)*/gm)]
        .map(([etape]) => etape)
        .filter((etape) => etape.includes("actions/upload-artifact@")),
    );
    expect(envois.length).toBe(2);
    for (const etape of envois) {
      expect(etape).toContain("continue-on-error: true");
    }
  });

  it("ne lancent jamais le code d'une PR venue d'un fork", () => {
    const [ci] = workflows as [string];
    const jobs = [...ci.matchAll(/^ {2}(\w+):\n(?: {4}.*\n|\n)*/gm)].filter(([bloc]) =>
      bloc.includes("runs-on:"),
    );
    expect(jobs.length).toBe(3);
    for (const [bloc] of jobs) {
      expect(bloc).toContain(
        "if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository",
      );
    }
  });

  it("ne reprennent pas une trivy-action antérieure au correctif 0.35.0", () => {
    const texte = workflows.join("\n");
    const versions = [...texte.matchAll(/aquasecurity\/trivy-action@\S+ # v?(\d+)\.(\d+)/g)];
    expect(versions.length).toBeGreaterThan(0);
    for (const [, majeure, mineure] of versions) {
      expect(Number(majeure) > 0 || Number(mineure) >= 35).toBe(true);
    }
  });
});
