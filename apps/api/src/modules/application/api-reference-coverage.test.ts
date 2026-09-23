import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Chaque route documentée doit exister dans l'API.
 *
 * La page « API » du panel est un contrat : un intégrateur y lit un chemin et
 * écrit son code autour. Une ligne fausse ne coûte rien à l'écran — elle
 * s'affiche exactement comme une vraie — et se découvre chez lui, en
 * production, une fois le travail fait.
 *
 * Sept l'étaient. Un jeton de console annoncé sur `ws-token` quand la route
 * s'appelle `websocket` ; une écriture de fichier en `PUT` quand elle est en
 * `POST` ; une suppression en `DELETE` quand elle passe par un `POST` portant
 * la liste des fichiers ; un `rotate-password` qui s'appelle `rotate` ; un
 * `execute` qui s'appelle `run` ; un listage `files/list` qui est la racine
 * `files` ; et un profil `/account` qui vit sous `auth`.
 *
 * **Le test vit ici et non côté interface**, où le catalogue est pourtant
 * écrit : le paquet web n'exécute aucun test, et un fichier posé là n'aurait
 * jamais tourné — un contrôle qui ne s'exécute pas est pire qu'absent,
 * puisqu'on croit être couvert. C'est d'ailleurs la question qu'il pose lui-même
 * à la documentation.
 *
 * Il lit les deux sources en texte, comme les autres contrôles de couverture
 * de ce dépôt : recopier les routes dans une troisième liste aurait exactement
 * le défaut qu'on surveille.
 */

const RACINE = join(import.meta.dirname, "..", "..", "..", "..", "..");
/*
 * Le catalogue a déménagé dans `contracts`.
 *
 * Il vivait dans l'interface, seul lecteur à l'époque. Depuis que la
 * spécification OpenAPI en découle aussi, il est remonté là où les deux
 * peuvent le lire — et `apps/web/src/lib/api-reference.ts` n'est plus qu'une
 * réexportation. Ce test lisait donc un fichier de dix lignes et n'y trouvait
 * plus aucune route : il a signalé le déplacement, ce qui est exactement son
 * travail.
 */
const DOC = join(RACINE, "packages", "contracts", "src", "api-catalogue.ts");
const API = join(RACINE, "apps", "api", "src");

/** La doc écrit des chemins relatifs ; chaque tableau porte son préfixe. */
const PREFIXES: Record<string, string> = {
  CLIENT_ROUTES: "/api/v1/client",
  SESSION_ROUTES: "/api/v1",
  APPLICATION_ROUTES: "/api/v1/application",
};

/**
 * Ramène deux écritures du même chemin à une seule.
 *
 * Nest nomme ses paramètres `:id`, la documentation `{server}` — deux façons
 * de dire « un identifiant ici ». Comparer les noms ferait échouer le test sur
 * une différence de vocabulaire qui n'intéresse personne. La requête tombe
 * pour la même raison : `?directory=` n'est pas du routage.
 */
function normalise(route: string): string {
  return route
    .split("?")[0]
    ?.replace(/[:{][a-zA-Z_]+\}?/g, ":x")
    .replace(/\/+$/, "") as string;
}

function documentees(): { groupe: string; route: string }[] {
  const source = readFileSync(DOC, "utf8");
  const bornes = Object.keys(PREFIXES)
    .map((nom) => ({ nom, debut: source.indexOf(`export const ${nom}`) }))
    .filter((b) => b.debut >= 0)
    .sort((a, b) => a.debut - b.debut);

  const out: { groupe: string; route: string }[] = [];
  bornes.forEach((borne, index) => {
    const fin = bornes[index + 1]?.debut ?? source.length;
    const bloc = source.slice(borne.debut, fin);
    for (const m of bloc.matchAll(
      /method:\s*"([A-Z]+)",\s*\n(?:\s*\/\/[^\n]*\n)*\s*path:\s*"([^"]+)"/g,
    )) {
      out.push({ groupe: borne.nom, route: `${m[1]} ${PREFIXES[borne.nom]}${m[2]}` });
    }
  });
  return out;
}

function reelles(directory: string): Set<string> {
  const found = new Set<string>();

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const route of reelles(full)) found.add(route);
      continue;
    }
    if (!/\.controller\.ts$/.test(entry.name)) continue;

    const source = readFileSync(full, "utf8");
    const prefixe = /@Controller\("([^"]*)"\)/.exec(source)?.[1] ?? "";
    for (const m of source.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:"([^"]*)")?\s*\)/g)) {
      const chemin = `/${[prefixe, m[2] ?? ""].filter(Boolean).join("/")}`;
      found.add(normalise(`${m[1]?.toUpperCase() ?? ""} ${chemin}`));
    }
  }

  return found;
}

describe("documentation de l'API", () => {
  const routes = reelles(API);

  it("trouve les contrôleurs et le catalogue", () => {
    // Sans ce garde-fou, un chemin cassé rendrait deux ensembles vides et le
    // test suivant passerait pour une raison trompeuse.
    expect(routes.size).toBeGreaterThan(100);
    expect(documentees().length).toBeGreaterThan(50);
  });

  /*
   * Non-régression : l'aide de la page API, écrite dans les catalogues de
   * traduction et non dans le catalogue de routes, annonçait encore
   * `POST /servers/{server}/ws-token` — une route qui n'a jamais existé sous
   * ce nom. Le test ci-dessous ne la voyait pas, puisqu'il ne lit que le
   * catalogue. Toute route citée en `<c>VERBE /chemin</c>` dans un message
   * doit donc, elle aussi, exister sous l'un des préfixes publics.
   */
  it("ne cite dans les textes de l'interface que des routes existantes", () => {
    const messages = join(RACINE, "packages", "i18n", "src", "messages");
    const citees: string[] = [];
    for (const fichier of readdirSync(messages).filter((nom) => nom.endsWith(".json"))) {
      const texte = readFileSync(join(messages, fichier), "utf8");
      for (const m of texte.matchAll(/<c>(GET|POST|PUT|PATCH|DELETE) (\/[^<\s]*)<\/c>/g)) {
        citees.push(`${fichier} ${m[1]} ${m[2]}`);
      }
    }

    const absentes = citees.filter((citation) => {
      const [, verbe, chemin] = citation.split(" ");
      return !Object.values(PREFIXES).some((prefixe) =>
        routes.has(normalise(`${verbe} ${prefixe}${chemin}`)),
      );
    });

    expect(citees.length).toBeGreaterThan(0);
    expect(absentes).toEqual([]);
  });

  it("ne documente que des routes existantes", () => {
    const absentes = documentees()
      .filter(({ route }) => !routes.has(normalise(route)))
      .map(({ groupe, route }) => `[${groupe}] ${route}`);

    expect(absentes).toEqual([]);
  });
});
