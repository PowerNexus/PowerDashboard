/**
 * Expressions cron à cinq champs (§6.5).
 *
 * Écrit à la main plutôt qu'emprunté à une bibliothèque, pour la même raison
 * que la signature JWT : la règle tient en une centaine de lignes, elle est
 * entièrement testable, et une dépendance de plus dans la chaîne
 * d'approvisionnement coûte davantage que ce qu'elle épargne.
 *
 * Le sous-ensemble est celui que l'interface sait construire : valeurs,
 * listes `a,b`, plages `a-b`, pas `* /n` et `a-b/n`, et `*`. Les raccourcis
 * `@daily` et les noms de mois ne sont pas reconnus — l'écran ne les produit
 * pas, et les accepter sans les tester donnerait une tâche qui ne part jamais.
 */

export interface CronFields {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

export class CronSyntaxError extends Error {
  constructor(field: string, value: string) {
    super(`Champ « ${field} » invalide : « ${value} ».`);
    this.name = "CronSyntaxError";
  }
}

interface Range {
  min: number;
  max: number;
  name: string;
}

const RANGES: Record<keyof CronFields, Range> = {
  minute: { min: 0, max: 59, name: "minute" },
  hour: { min: 0, max: 23, name: "heure" },
  dayOfMonth: { min: 1, max: 31, name: "jour du mois" },
  month: { min: 1, max: 12, name: "mois" },
  // 0 et 7 désignent tous deux dimanche, comme dans cron : les deux
  // conventions circulent, et refuser l'une ferait échouer des expressions
  // parfaitement ordinaires copiées d'ailleurs.
  dayOfWeek: { min: 0, max: 7, name: "jour de la semaine" },
};

/** Valeurs admises par un champ, développées une fois pour toutes. */
export function expandField(expression: string, field: keyof CronFields): Set<number> {
  const range = RANGES[field];
  const values = new Set<number>();

  for (const part of expression.split(",")) {
    const [spec, stepText] = part.split("/");
    if (spec === undefined || spec === "") throw new CronSyntaxError(range.name, expression);

    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new CronSyntaxError(range.name, expression);

    let from: number;
    let to: number;

    if (spec === "*") {
      from = range.min;
      to = range.max;
    } else if (spec.includes("-")) {
      const [a, b] = spec.split("-");
      from = Number(a);
      to = Number(b);
    } else {
      from = Number(spec);
      to = from;
      // Une valeur seule avec un pas — « 5/10 » — se lit « à partir de 5 » en
      // cron, jusqu'au bout de la plage. L'écrire explicitement évite de
      // n'enregistrer que la valeur 5.
      if (stepText !== undefined) to = range.max;
    }

    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < range.min ||
      to > range.max ||
      from > to
    ) {
      throw new CronSyntaxError(range.name, expression);
    }

    for (let value = from; value <= to; value += step) values.add(value);
  }

  if (values.size === 0) throw new CronSyntaxError(range.name, expression);

  // Dimanche s'écrit 0 ou 7 : les deux sont conservés pour que la comparaison
  // n'ait pas à connaître la convention employée à l'écriture.
  if (field === "dayOfWeek" && (values.has(0) || values.has(7))) {
    values.add(0);
    values.add(7);
  }
  return values;
}

/** Lève `CronSyntaxError` au premier champ inexploitable. */
export function assertValidCron(cron: CronFields): void {
  for (const field of Object.keys(RANGES) as (keyof CronFields)[]) {
    expandField(cron[field], field);
  }
}

/**
 * Vrai quand l'instant donné correspond à l'expression.
 *
 * Attention au « ou » du jour : quand *les deux* champs de jour sont
 * contraints, cron déclenche si **l'un ou l'autre** correspond, et non les
 * deux. C'est contre-intuitif et c'est la source d'erreur classique — un
 * « 1er du mois ET lundi » se comporterait comme « 1er du mois OU lundi ».
 * Le comportement historique est reproduit ici, parce qu'une expression
 * copiée d'un crontab doit donner le même résultat.
 */
export function cronMatches(cron: CronFields, date: Date): boolean {
  const minute = expandField(cron.minute, "minute");
  const hour = expandField(cron.hour, "hour");
  const month = expandField(cron.month, "month");
  const dayOfMonth = expandField(cron.dayOfMonth, "dayOfMonth");
  const dayOfWeek = expandField(cron.dayOfWeek, "dayOfWeek");

  if (!minute.has(date.getUTCMinutes())) return false;
  if (!hour.has(date.getUTCHours())) return false;
  if (!month.has(date.getUTCMonth() + 1)) return false;

  const domRestricted = cron.dayOfMonth.trim() !== "*";
  const dowRestricted = cron.dayOfWeek.trim() !== "*";
  const domMatch = dayOfMonth.has(date.getUTCDate());
  const dowMatch = dayOfWeek.has(date.getUTCDay());

  if (domRestricted && dowRestricted) return domMatch || dowMatch;
  if (domRestricted) return domMatch;
  if (dowRestricted) return dowMatch;
  return true;
}

/** Au-delà, l'expression ne correspond à aucune date atteignable (le 30 février). */
const SEARCH_LIMIT_MINUTES = 366 * 24 * 60;

/**
 * Prochaine occurrence **strictement après** `from`.
 *
 * Strictement : sans cela, une tâche qui vient de s'exécuter se replanifierait
 * à la même minute et repartirait en boucle jusqu'à la minute suivante.
 *
 * `null` quand rien ne correspond dans l'année à venir — « 31 février » est
 * une expression syntaxiquement valide qui ne survient jamais. Renvoyer une
 * date arbitraire ferait exécuter la tâche à un moment que personne n'a
 * demandé ; `null` permet de le dire à l'écran.
 */
export function nextCronRun(cron: CronFields, from: Date = new Date()): Date | null {
  assertValidCron(cron);

  // On repart de la minute suivante, secondes remises à zéro : cron a une
  // résolution d'une minute, et garder les secondes ferait dériver l'horaire
  // d'exécution à chaque replanification.
  const candidate = new Date(from);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  for (let i = 0; i < SEARCH_LIMIT_MINUTES; i++) {
    if (cronMatches(cron, candidate)) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return null;
}

export function cronToString(cron: CronFields): string {
  return [cron.minute, cron.hour, cron.dayOfMonth, cron.month, cron.dayOfWeek].join(" ");
}
