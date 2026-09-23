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
