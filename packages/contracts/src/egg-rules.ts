/**
 * Règles de validation des variables d'egg, au format Pterodactyl.
 *
 * Un egg déclare pour chaque variable une chaîne de règles Laravel
 * (`required|string|max:20`, `regex:/^[a-z]+$/`, `in:true,false`…). Wings ne
 * les applique pas : c'est le panel qui doit le faire, sinon la valeur part
 * telle quelle dans l'environnement du conteneur et dans la commande de
 * démarrage, où `{{VAR}}` est substitué par l'entrypoint de l'image.
 *
 * Le sous-ensemble reconnu couvre les règles employées par les eggs
 * officiels. Une règle inconnue est ignorée plutôt que refusée : un egg
 * importé ne doit pas devenir inutilisable pour une règle exotique, mais il
 * ne doit pas non plus faire passer une valeur qu'une règle connue refuse.
 */

const BOOLEANS = new Set(["true", "false", "1", "0", "yes", "no", "on", "off"]);

/**
 * Rend `null` si la valeur respecte les règles, sinon le motif du refus.
 *
 * `nullable` (ou l'absence de `required`) accepte la chaîne vide sans
 * examiner les autres règles : une valeur vide est « rien », pas une chaîne
 * trop courte.
 */
export function validateVariableValue(rules: string, value: string): string | null {
  const list = splitRules(rules);
  const required = list.some((rule) => rule.name === "required");

  if (value === "") return required ? "valeur requise" : null;

  for (const rule of list) {
    const problem = check(rule, value);
    if (problem !== null) return problem;
  }
  return null;
}

interface Rule {
  name: string;
  argument: string;
}

/**
 * Découpe `a|b:x|regex:/c|d/` en règles.
 *
 * Le séparateur `|` peut apparaître **dans** une expression régulière : la
 * règle `regex:` absorbe donc tout ce qui suit jusqu'à la fin de la chaîne,
 * comme le fait Laravel, qui recommande de la placer en dernier.
 */
function splitRules(rules: string): Rule[] {
  const parsed: Rule[] = [];
  let rest = rules.trim();
  while (rest !== "") {
    const regexAt = rest.match(/^regex:/i);
    if (regexAt) {
      parsed.push({ name: "regex", argument: rest.slice(6) });
      break;
    }
    const at = rest.indexOf("|");
    const piece = at === -1 ? rest : rest.slice(0, at);
    rest = at === -1 ? "" : rest.slice(at + 1);
    const colon = piece.indexOf(":");
    parsed.push({
      name: (colon === -1 ? piece : piece.slice(0, colon)).trim().toLowerCase(),
      argument: colon === -1 ? "" : piece.slice(colon + 1).trim(),
    });
  }
  return parsed;
}

function check(rule: Rule, value: string): string | null {
  switch (rule.name) {
    case "numeric":
      return /^-?\d+(\.\d+)?$/.test(value) ? null : "nombre attendu";
    case "integer":
      return /^-?\d+$/.test(value) ? null : "entier attendu";
    case "boolean":
      return BOOLEANS.has(value.toLowerCase()) ? null : "booléen attendu";
    case "alpha_dash":
      return /^[A-Za-z0-9_-]+$/.test(value) ? null : "lettres, chiffres, tirets seulement";
    case "alpha_num":
      return /^[A-Za-z0-9]+$/.test(value) ? null : "lettres et chiffres seulement";
    case "in": {
      const allowed = rule.argument.split(",").map((s) => s.trim());
      return allowed.includes(value) ? null : `valeur attendue parmi ${allowed.join(", ")}`;
    }
    case "max":
      return bounded(value, rule.argument, (n, limit) => n <= limit, `au plus ${rule.argument}`);
    case "min":
      return bounded(value, rule.argument, (n, limit) => n >= limit, `au moins ${rule.argument}`);
    case "between": {
      const [low, high] = rule.argument.split(",").map((s) => Number(s.trim()));
      if (low === undefined || high === undefined || Number.isNaN(low) || Number.isNaN(high)) {
        return null;
      }
      const measure = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value.length;
      return measure >= low && measure <= high ? null : `entre ${low} et ${high}`;
    }
    case "regex": {
      const pattern = compile(rule.argument);
      if (pattern === null) return null;
      return pattern.test(value) ? null : "format invalide";
    }
    case "url":
      try {
        new URL(value);
        return null;
      } catch {
        return "URL attendue";
      }
    case "ip":
    case "ipv4":
      return /^(\d{1,3})(\.\d{1,3}){3}$/.test(value) ? null : "adresse IP attendue";
    default:
      // `required`, `nullable`, `string` et les règles inconnues : rien à vérifier.
      return null;
  }
}

/**
 * `max`/`min` portent sur le nombre si la valeur en est un, sur la longueur
 * sinon — comme Laravel, qui décide selon la règle `numeric` voisine. Ici la
 * forme de la valeur suffit.
 */
function bounded(
  value: string,
  argument: string,
  compare: (n: number, limit: number) => boolean,
  problem: string,
): string | null {
  const limit = Number(argument);
  if (Number.isNaN(limit)) return null;
  const measure = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value.length;
  return compare(measure, limit) ? null : problem;
}

/** `regex:/^abc$/i` → `RegExp`. Rend `null` si l'expression est illisible. */
function compile(argument: string): RegExp | null {
  const match = /^\/(.*)\/([a-z]*)$/s.exec(argument.trim());
  if (!match) return null;
  try {
    // Les drapeaux PHP sans équivalent JavaScript sont écartés.
    const flags = (match[2] ?? "").replace(/[^gimsuy]/g, "");
    return new RegExp(match[1] ?? "", flags);
  } catch {
    return null;
  }
}

/* --- Écriture des règles ---------------------------------------------------- */

/**
 * Règles qu'on accepte d'**écrire** depuis l'éditeur d'egg.
 *
 * Exactement celles que `check()` applique, plus les quatre qu'il sait sans
 * effet (`required`, `nullable`, `string`, `sometimes`). La lecture reste
 * tolérante — une règle inconnue d'un egg importé est ignorée —, mais
 * l'écriture ne l'est pas : un administrateur qui tape `requird` ou `digits:5`
 * croirait protéger la variable, alors que le panel laisserait tout passer.
 * Mieux vaut le lui dire au moment où il la tape.
 */
export const WRITABLE_EGG_RULES = [
  "required",
  "nullable",
  "string",
  "sometimes",
  "numeric",
  "integer",
  "boolean",
  "alpha_dash",
  "alpha_num",
  "in",
  "max",
  "min",
  "between",
  "regex",
  "url",
  "ip",
  "ipv4",
] as const;

/** Ce qu'on reproche à une chaîne de règles, sous une forme traduisible. */
export type RulesProblem =
  | { code: "rulesEmpty" }
  | { code: "ruleUnknown"; rule: string }
  | { code: "ruleNeedsNumber"; rule: string }
  | { code: "ruleNeedsTwoNumbers"; rule: string }
  | { code: "ruleInEmpty" }
  | { code: "ruleRegexInvalid" };

/**
 * Vérifie une chaîne de règles **avant** de l'enregistrer.
 *
 * Le découpage est celui de `validateVariableValue` — même fonction, pas une
 * copie : une règle que l'éditeur accepte doit être lue de la même façon par
 * ce qui l'appliquera ensuite aux serveurs. Rend le premier défaut, ou `null`.
 */
export function rulesProblem(rules: string): RulesProblem | null {
  const list = splitRules(rules);
  if (list.length === 0) return { code: "rulesEmpty" };

  for (const rule of list) {
    if (!(WRITABLE_EGG_RULES as readonly string[]).includes(rule.name)) {
      return { code: "ruleUnknown", rule: rule.name || "|" };
    }
    if ((rule.name === "max" || rule.name === "min") && !isNumber(rule.argument)) {
      return { code: "ruleNeedsNumber", rule: rule.name };
    }
    if (rule.name === "between") {
      const bounds = rule.argument.split(",");
      if (bounds.length !== 2 || !bounds.every((bound) => isNumber(bound))) {
        return { code: "ruleNeedsTwoNumbers", rule: rule.name };
      }
    }
    if (rule.name === "in" && rule.argument.split(",").every((value) => value.trim() === "")) {
      return { code: "ruleInEmpty" };
    }
    // `compile` rend `null` sur une expression illisible, et `check` laisse
    // alors tout passer : c'est exactement ce qu'il faut refuser à l'écriture.
    if (rule.name === "regex" && compile(rule.argument) === null) {
      return { code: "ruleRegexInvalid" };
    }
  }
  return null;
}

/** La règle `required` figure-t-elle dans la chaîne ? */
export function rulesRequireValue(rules: string): boolean {
  return splitRules(rules).some((rule) => rule.name === "required");
}

function isNumber(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Number(value.trim()));
}
