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

  /*
   * En-têtes de transport (ASVS 14.4.5, 14.3.3). HSTS couvrait le seul nom du
   * panel : un sous-domaine en HTTP restait une porte vers une page servie en
   * clair sous son nom. `preload`, lui, ne se retire pas en un redéploiement :
   * absent à dessein.
   */
  it("impose HTTPS aux sous-domaines, sans s'inscrire à la liste de préchargement", () => {
    const hsts = /add_header Strict-Transport-Security "([^"]+)" always;/.exec(directives)?.[1];
    expect(hsts).toBeDefined();
    expect(hsts).toMatch(/max-age=31536000/);
    expect(hsts).toContain("includeSubDomains");
    expect(hsts).not.toContain("preload");
  });

  it("ne donne sa version de nginx dans aucune réponse", () => {
    const serveurs = directives.split(/^server \{/m).slice(1);
    expect(serveurs.length).toBe(2);
    for (const bloc of serveurs) expect(bloc).toMatch(/^\s*server_tokens off;/m);
  });

  it("ne pose pas d'agrafage OCSP sans répondeur, et dit pourquoi", () => {
    // Let's Encrypt n'inscrit plus d'adresse OCSP dans ses certificats :
    // `ssl_stapling on` n'y produirait qu'un avertissement au démarrage.
    expect(directives).not.toMatch(/ssl_stapling/);
    expect(vhost).toMatch(/OCSP/);
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
 * Le jeton du lien de facturation n'entre dans aucun journal d'accès (NC-57).
 *
 * Il voyage dans le chemin (`/sso/<jeton>`) et ouvre une session : écrit dans
 * le journal d'accès, il se lisait par quiconque lit les journaux, pendant les
 * deux minutes où il vaut une session. Les trois vhosts qui servent
 * l'interface sont concernés : celui de la plateforme, celui de la production
 * locale, et celui des domaines de revendeurs, où atterrissent leurs clients.
 *
 * Un bloc `location` à expression régulière remplace `location /` pour ces
 * chemins : il doit donc relayer les mêmes en-têtes d'identité, faute de quoi
 * la page recevrait l'adresse de nginx et le mauvais domaine.
 */
describe("jeton du lien de facturation", () => {
  const vhosts = {
    "infra/prod/panel.conf": vhost,
    "infra/local/gamedashboard.local.conf": readFileSync(
      join(RACINE, "infra", "local", "gamedashboard.local.conf"),
      "utf8",
    ),
    "infra/prod/certificates.sh (domaine de revendeur)": (() => {
      const agent = readFileSync(join(PROD, "certificates.sh"), "utf8");
      const debut = agent.indexOf("bloc_servi()");
      return agent.slice(debut, agent.indexOf("\nEOF", debut)).replaceAll("\\$", "$");
    })(),
  };

  /**
   * Le corps d'un bloc `location`, sans commentaires ni imbrication.
   *
   * Le dernier du fichier : le serveur HTTPS vient après celui du port 80, dont
   * le `location /` ne fait que rediriger.
   */
  function bloc(conf: string, entete: string): string | null {
    const sansCommentaires = conf.replace(/#.*$/gm, "");
    const debut = sansCommentaires.lastIndexOf(`location ${entete} {`);
    if (debut < 0) return null;
    return sansCommentaires.slice(debut, sansCommentaires.indexOf("}", debut));
  }

  const entetes = (corps: string) =>
    [...corps.matchAll(/proxy_set_header\s+([\w-]+)\s+([^;]+);/g)]
      .map((m) => `${m[1]} ${(m[2] ?? "").trim()}`)
      .filter((ligne) => !/^(Upgrade|Connection) /.test(ligne))
      .sort();

  for (const [chemin, conf] of Object.entries(vhosts)) {
    it(`${chemin} ne journalise pas /sso/<jeton>`, () => {
      const sso = bloc(conf, "~ ^/sso/");
      expect(sso, "aucun bloc location ~ ^/sso/").not.toBeNull();
      expect(sso).toMatch(/^\s*access_log off;/m);
      expect(sso).toMatch(/proxy_pass http:\/\/127\.0\.0\.1:(3210|\$PANEL_WEB_PORT);/);
    });

    it(`${chemin} relaie à /sso/ les mêmes en-têtes que l'interface`, () => {
      expect(entetes(bloc(conf, "~ ^/sso/") ?? "")).toEqual(entetes(bloc(conf, "/") ?? ""));
    });
  }
});

/**
 * Les routes du daemon sont limitées, sans gêner Wings (NC-49).
 *
 * `/api/remote/` était le seul préfixe exposé sans `limit_req` : un jeton
 * éprouvé en boucle, ou un node qui s'emballe, payait chaque requête en
 * lecture de base. La limite doit pourtant laisser passer le trafic légitime
 * d'un daemon — l'inventaire paginé en parallèle à son démarrage, une
 * configuration relue par serveur démarré, le journal d'activité par lots —
 * et surtout **ne pas lui répondre 429** : Wings abandonne sur tout 4xx et
 * ne rejoue que les 5xx. Un compte rendu de sauvegarde refusé en 429 lui
 * ferait effacer l'archive ; en 503, il réessaie quelques secondes plus tard.
 */
describe("limitation des routes du daemon", () => {
  const bloc = /location \/api\/remote\/ \{([^}]*)\}/.exec(directives)?.[1] ?? "";

  it("pose une limite par adresse sur /api/remote/", () => {
    expect(bloc).not.toBe("");
    expect(bloc).toMatch(/^\s*limit_req\s+zone=gd_remote\s/m);
    expect(directives).toMatch(/^limit_req_zone \$binary_remote_addr zone=gd_remote:/m);
  });

  it("laisse passer le démarrage d'un node chargé", () => {
    const rate = /zone=gd_remote:\S+\s+rate=(\d+)r\/s;/.exec(directives)?.[1];
    const burst = /limit_req\s+zone=gd_remote\s+burst=(\d+)\s+nodelay;/.exec(bloc)?.[1];
    // Des dizaines de serveurs démarrés d'un coup, plus l'inventaire paginé :
    // plusieurs centaines de requêtes en rafale, puis un débit soutenu.
    expect(Number(rate)).toBeGreaterThanOrEqual(10);
    expect(Number(burst)).toBeGreaterThanOrEqual(200);
  });

  it("refuse en 503, que Wings rejoue, et non en 429, qu'il abandonne", () => {
    expect(bloc).toMatch(/^\s*limit_req_status\s+503;/m);
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
  const workflows = ["ci.yml", "release.yml", "captures.yml"].map((nom) =>
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
    expect(cibles.length).toBe(5);
    for (const cible of cibles) {
      expect(cible).toBe(`\${{ fromJSON(vars.CI_RUNNER || '["self-hosted","linux","x64"]') }}`);
    }
  });

  it("ne téléversent le cache pnpm que depuis un runner de GitHub", () => {
    const caches = workflows.flatMap((texte) =>
      [...texte.matchAll(/^\s*cache:\s*(.+)$/gm)].map((m) => m[1]),
    );
    expect(caches.length).toBe(5);
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
    expect(envois.length).toBe(3);
    for (const etape of envois) {
      expect(etape).toContain("continue-on-error: true");
    }
  });

  it("rendent l'espace de travail au runner après une action conteneur", () => {
    const [ci] = workflows as [string];
    const semgrep = ci.indexOf("semgrep/semgrep-action@");
    const rendu = ci.indexOf("name: Rendre l'espace de travail au runner");
    expect(semgrep).toBeGreaterThan(0);
    expect(rendu).toBeGreaterThan(semgrep);
    const etape = ci.slice(rendu, ci.indexOf("\n\n", rendu));
    expect(etape).toContain("if: always()");
    expect(etape).toMatch(/chown -R "\$\(id -u\):\$\(id -g\)" \/w \/t/);
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

  it("lèvent la seconde preuve du personnel sur la base d'essai, avant la suite", () => {
    // Exigée par défaut (NC-10), et le compte d'essai est administrateur : sans
    // cette étape, chaque écran d'administration visité par la suite serait
    // l'explication « seconde preuve exigée », captures comprises.
    const [ci, , captures] = workflows as [string, string, string];
    for (const [nom, texte] of [
      ["ci.yml", ci],
      ["captures.yml", captures],
    ] as const) {
      const levee = texte.indexOf("values ('security.staffRequires2fa', 'false'::jsonb)");
      const suite = texte.search(/run: pnpm e2e|playwright test/);
      expect(levee, nom).toBeGreaterThan(0);
      expect(suite, nom).toBeGreaterThan(levee);
    }
  });

  /*
   * Sans `permissions:`, le jeton du workflow reçoit les droits par défaut du
   * dépôt — écriture comprise selon son réglage — et ci.yml le tendait à
   * Semgrep, conteneur root, sur une machine à nous. La lecture seule se pose
   * en tête ; un job qui a besoin de plus le déclare lui-même, avec sa raison.
   */
  it("ne donnent au jeton que la lecture du dépôt, en tête de chaque workflow", () => {
    for (const [nom, texte] of ["ci.yml", "release.yml", "captures.yml"].map(
      (fichier, rang) => [fichier, workflows[rang] ?? ""] as const,
    )) {
      expect(texte, nom).toMatch(/^permissions:\n {2}contents: read\n\n/m);
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

/**
 * Chaque release publie l'inventaire de ce qu'elle livre (PLAN §5.4), signé et
 * rattaché à l'archive.
 */
describe("inventaire des dépendances des releases", () => {
  const release = readFileSync(join(RACINE, ".github", "workflows", "release.yml"), "utf8");
  const inventaire = `dist/gamedashboard-\${{ env.VERSION }}.cdx.json`;
  const etape = (nom: string) => {
    const debut = release.indexOf(`- name: ${nom}`);
    expect(debut, nom).toBeGreaterThan(0);
    return { debut, texte: release.slice(debut, release.indexOf("\n\n", debut)) };
  };

  it("est produit au format CycloneDX, dans les fichiers publiés", () => {
    const { texte } = etape("Inventaire des dépendances (SBOM)");
    expect(texte).toContain("uses: aquasecurity/trivy-action@");
    expect(texte).toContain("format: cyclonedx");
    expect(texte).toContain(`output: ${inventaire}`);
    // Les licences se lisent dans node_modules : l'exclure les ferait disparaître.
    expect(texte).not.toMatch(/skip-dirs:.*node_modules/);
  });

  it("est attesté contre l'archive, avant la publication", () => {
    const production = etape("Inventaire des dépendances (SBOM)");
    const attestation = etape("Attester l'inventaire");
    const publication = etape("Publier");
    expect(attestation.texte).toContain("uses: actions/attest@");
    expect(attestation.texte).toContain("subject-path: dist/gamedashboard-*.tar.gz");
    expect(attestation.texte).toContain(`sbom-path: ${inventaire}`);
    expect(attestation.debut).toBeGreaterThan(production.debut);
    expect(publication.debut).toBeGreaterThan(attestation.debut);
  });
});

/**
 * Le scan ZAP (PLAN §5.4) : présent, reproductible, et honnête sur ce qu'il
 * laisse passer.
 */
describe("scan ZAP de la CI", () => {
  const ci = readFileSync(join(RACINE, ".github", "workflows", "ci.yml"), "utf8");
  const script = readFileSync(join(RACINE, "infra", "ci", "zap-baseline.sh"), "utf8");
  const regles = readFileSync(join(RACINE, "infra", "ci", "zap-regles.tsv"), "utf8")
    .split("\n")
    .filter((ligne) => ligne.trim() !== "" && !ligne.startsWith("#"));

  it("tourne après les parcours, sur l'application compilée", () => {
    const parcours = ci.indexOf("name: Parcours et accessibilité");
    const scan = ci.indexOf("name: Scan ZAP");
    expect(parcours).toBeGreaterThan(0);
    expect(scan).toBeGreaterThan(parcours);
    expect(ci.slice(scan, ci.indexOf("\n\n", scan))).toContain(
      "run: bash infra/ci/zap-baseline.sh",
    );
  });

  it("épingle l'image de ZAP par empreinte", () => {
    expect(script).toMatch(
      /^IMAGE=ghcr\.io\/zaproxy\/zaproxy@sha256:[0-9a-f]{64} # \d+\.\d+\.\d+$/m,
    );
  });

  it("ne fait jamais taire un avertissement sans le dire", () => {
    // Sans -I, un avertissement rend un code non nul : c'est ce qui fait
    // échouer le job sur une alerte nouvelle.
    expect(script).toMatch(/zap-baseline\.py -t "\$CIBLE" -c regles\.tsv/);
    expect(script).not.toMatch(/zap-baseline\.py[^\n]* -I\b/);
    // Sans -silent, ZAP télécharge ses règles du jour : le verdict ne
    // dépendrait plus seulement de l'image épinglée.
    expect(script).toMatch(/zap-baseline\.py[^\n]* -z -silent/);
  });

  it("ne confond pas un Docker absent avec une alerte", () => {
    const controle = script.indexOf("docker info >/dev/null 2>&1 ||");
    expect(controle).toBeGreaterThan(0);
    expect(controle).toBeLessThan(script.indexOf("docker run --rm"));
    expect(script.slice(controle, script.indexOf("\n", controle))).toContain("exit 3");
  });

  it("n'écrit pas dans l'espace de travail depuis le conteneur", () => {
    expect(script).toContain("TRAVAIL=$(mktemp -d)");
    expect(script).toContain('-v "$TRAVAIL:/zap/wrk:rw"');
  });

  it("justifie chaque exception", () => {
    expect(regles.length).toBeGreaterThan(0);
    for (const ligne of regles) {
      const [id, niveau, raison] = ligne.split("\t");
      expect(id).toMatch(/^\d+$/);
      expect(["IGNORE", "INFO", "WARN", "FAIL"]).toContain(niveau);
      expect((raison ?? "").length).toBeGreaterThan(40);
    }
  });
});

/**
 * Les captures de référence de la suite visuelle ne se prennent que sur le
 * runner, à la demande : une référence prise ailleurs ferait échouer la CI
 * sur des différences de rendu de polices que personne n'a introduites.
 */
describe("workflow des captures de référence", () => {
  const captures = readFileSync(join(RACINE, ".github", "workflows", "captures.yml"), "utf8");

  it("ne se lance qu'à la main", () => {
    const declencheurs = captures.slice(
      captures.indexOf("\non:"),
      captures.indexOf("\nconcurrency:"),
    );
    expect(declencheurs.trim()).toBe("on:\n  workflow_dispatch:");
  });

  it("reprend toutes les captures de la suite visuelle, et les pousse sur la branche lancée", () => {
    expect(captures).toContain("playwright test e2e/visuel.spec.ts --update-snapshots=all");
    expect(captures).toContain("git add apps/web/e2e/visuel.spec.ts-snapshots");
    expect(captures).toContain(`git push origin "HEAD:\${{ github.ref_name }}"`);
  });
});
