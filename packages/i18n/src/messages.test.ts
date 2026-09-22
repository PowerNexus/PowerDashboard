import { describe, expect, it } from "vitest";
import { LOCALES, MESSAGES } from "./index";

/** Aplatit un catalogue en chemins pointés : `nav.servers`, `login.email`… */
function flatten(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") {
    out.set(prefix, value);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      for (const [k, v] of flatten(child, path)) out.set(k, v);
    }
  }
  return out;
}

/**
 * Sélecteurs d'une branche de pluriel ou de choix, en ICU.
 *
 * `=0`, `one`, `other`… Ce qui suit est un **message**, pas une variable : dans
 * `{days, plural, =1 {Demain} other {Dans # jours}}`, « Demain » est du texte
 * traduisible, et l'attendre à l'identique en anglais reviendrait à exiger que
 * la traduction dise « Demain ».
 */
const BRANCH_SELECTOR = /(?:=\d+|zero|one|two|few|many|other|select|true|false)\s*$/;

/** Variables d'un message ICU : `{count}`, `{minutes}`, `{occurrences, plural, …}`. */
function placeholders(message: string): Set<string> {
  const found = new Set<string>();
  for (const match of message.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*(?:,[^{}]*)?[},]/g)) {
    if (!match[1]) continue;

    /*
     * Une branche d'un seul mot ressemble à une variable.
     *
     * `{Demain}` a exactement la forme de `{count}` ; seul ce qui la précède
     * les distingue. Sans ce test, une branche courte était comptée comme une
     * variable, et deux catalogues parfaitement corrects se voyaient reprocher
     * d'employer des variables différentes — un faux positif qui ne se
     * déclenche que sur les traductions les mieux écrites, les plus brèves.
     */
    if (BRANCH_SELECTOR.test(message.slice(0, match.index))) continue;

    found.add(match[1]);
  }
  return found;
}

const catalogues = Object.fromEntries(
  LOCALES.map((locale) => [locale, flatten(MESSAGES[locale])]),
) as Record<(typeof LOCALES)[number], Map<string, string>>;

const reference = catalogues.fr;

/**
 * Une traduction manquante ne provoque jamais d'erreur : elle affiche la clé
 * brute, ou du français à un anglophone. Le défaut est donc invisible pour qui
 * développe, et visible seulement pour l'utilisateur concerné — exactement le
 * genre de bogue qu'un test doit attraper à la place.
 */
describe("complétude des catalogues", () => {
  for (const locale of LOCALES) {
    if (locale === "fr") continue;

    it(`« ${locale} » ne manque aucune clé du français`, () => {
      const missing = [...reference.keys()].filter((key) => !catalogues[locale].has(key));
      expect(missing).toEqual([]);
    });

    it(`« ${locale} » n'a pas de clé orpheline`, () => {
      // Une clé qui n'existe plus en français est du texte mort : elle survit
      // aux refontes sans que personne ne la relise.
      const extra = [...catalogues[locale].keys()].filter((key) => !reference.has(key));
      expect(extra).toEqual([]);
    });

    it(`« ${locale} » emploie les mêmes variables que le français`, () => {
      // Le cas dangereux : « Réessayez dans {minutes} minutes » traduit en
      // « Try again in {mins} minutes ». Rien ne plante, la variable reste
      // affichée telle quelle à l'écran.
      const mismatched: string[] = [];
      for (const [key, frText] of reference) {
        const translated = catalogues[locale].get(key);
        if (translated === undefined) continue;
        const expected = [...placeholders(frText)].sort();
        const actual = [...placeholders(translated)].sort();
        if (expected.join(",") !== actual.join(",")) {
          mismatched.push(`${key} : attendu [${expected}], trouvé [${actual}]`);
        }
      }
      expect(mismatched).toEqual([]);
    });

    it(`« ${locale} » ne laisse aucun message vide`, () => {
      const empty = [...catalogues[locale]].filter(([, text]) => text.trim() === "");
      expect(empty.map(([key]) => key)).toEqual([]);
    });
  }
});

describe("cohérence du catalogue de référence", () => {
  it("ne contient aucun message vide", () => {
    expect([...reference].filter(([, text]) => text.trim() === "")).toEqual([]);
  });

  it("couvre tous les états de serveur du contrat", () => {
    // Un état affiché sans traduction apparaîtrait sous sa forme technique,
    // « install_failed », dans l'interface d'un client.
    const states = [
      "offline",
      "starting",
      "running",
      "stopping",
      "installing",
      "install_failed",
      "suspended",
      "restoring",
      "transferring",
      "crash_loop",
    ];
    for (const state of states) {
      expect(reference.has(`serverState.${state}`)).toBe(true);
    }
  });

  it("couvre tous les états de node", () => {
    for (const status of ["online", "stale", "maintenance", "unreachable"]) {
      expect(reference.has(`nodeStatus.${status}`)).toBe(true);
    }
  });
});

/**
 * Aucune clé ne doit contenir de point.
 *
 * `next-intl` découpe les chemins sur le point : `t("event.server.installed")`
 * descend dans `event`, puis `server`, puis `installed`. Une clé écrite à plat
 * — `"server.installed": "…"` à l'intérieur de `event` — n'est donc **jamais**
 * atteinte, et le message manque à l'exécution.
 *
 * C'est arrivé aux dix libellés des préférences de notification : ils étaient
 * bien traduits dans les deux langues, la vérification de parité passait, et
 * l'écran journalisait dix `MISSING_MESSAGE` à chaque rendu. La parité ne
 * pouvait rien y voir — les deux catalogues étaient également inatteignables.
 *
 * La règle est mécanique, donc vérifiable ici une fois pour toutes : un point
 * dans un nom de clé est une erreur de structure, quel que soit le contenu.
 */
describe("structure des clés", () => {
  it("n'a aucune clé contenant un point", () => {
    const fautives: string[] = [];

    function walk(value: unknown, path: string[]): void {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (key.includes(".")) fautives.push([...path, key].join(" > "));
        walk(child, [...path, key]);
      }
    }

    for (const locale of LOCALES) walk(MESSAGES[locale], [locale]);

    expect(fautives).toEqual([]);
  });
});
