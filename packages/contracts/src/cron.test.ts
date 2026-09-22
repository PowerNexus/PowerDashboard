import { describe, expect, it } from "vitest";
import {
  assertValidCron,
  type CronFields,
  CronSyntaxError,
  cronMatches,
  expandField,
  nextCronRun,
} from "./cron";

const cron = (
  minute: string,
  hour = "*",
  dayOfMonth = "*",
  month = "*",
  dayOfWeek = "*",
): CronFields => ({ minute, hour, dayOfMonth, month, dayOfWeek });

const at = (iso: string) => new Date(`${iso}Z`);

describe("développement d'un champ", () => {
  it("développe une valeur seule", () => {
    expect([...expandField("4", "hour")]).toEqual([4]);
  });

  it("développe une liste", () => {
    expect([...expandField("0,15,30,45", "minute")]).toEqual([0, 15, 30, 45]);
  });

  it("développe une plage", () => {
    expect([...expandField("1-4", "hour")]).toEqual([1, 2, 3, 4]);
  });

  it("développe un pas sur l'étoile", () => {
    expect([...expandField("*/15", "minute")]).toEqual([0, 15, 30, 45]);
  });

  it("développe un pas sur une plage", () => {
    expect([...expandField("0-30/10", "minute")]).toEqual([0, 10, 20, 30]);
  });

  it("lit « 5/10 » comme « à partir de 5 »", () => {
    // Convention cron : une valeur seule suivie d'un pas court jusqu'au bout
    // de la plage. La lire comme la seule valeur 5 exécuterait la tâche une
    // fois par heure au lieu de six.
    expect([...expandField("5/10", "minute")]).toEqual([5, 15, 25, 35, 45, 55]);
  });

  it("tient les deux écritures de dimanche", () => {
    // 0 et 7 désignent tous deux dimanche ; une expression copiée d'ailleurs
    // peut employer l'une ou l'autre.
    expect(expandField("0", "dayOfWeek").has(7)).toBe(true);
    expect(expandField("7", "dayOfWeek").has(0)).toBe(true);
  });

  const invalid: [string, keyof CronFields][] = [
    ["60", "minute"],
    ["24", "hour"],
    ["0", "dayOfMonth"],
    ["13", "month"],
    ["8", "dayOfWeek"],
    ["5-1", "hour"],
    ["*/0", "minute"],
    ["abc", "minute"],
    ["", "minute"],
    ["1-", "hour"],
  ];

  for (const [expression, field] of invalid) {
    it(`refuse ${JSON.stringify(expression)} sur ${field}`, () => {
      // Une expression acceptée mais incomprise donnerait une tâche qui ne
      // part jamais, sans que rien ne le signale.
      expect(() => expandField(expression, field)).toThrow(CronSyntaxError);
    });
  }
});

describe("correspondance", () => {
  it("reconnaît l'instant attendu", () => {
    expect(cronMatches(cron("0", "4"), at("2026-09-16T04:00:00"))).toBe(true);
    expect(cronMatches(cron("0", "4"), at("2026-09-16T05:00:00"))).toBe(false);
  });

  it("combine jour du mois et jour de semaine par un OU", () => {
    // Piège classique de cron, reproduit volontairement : deux champs de jour
    // contraints se comportent comme « l'un OU l'autre ».
    const monthly1stOrMonday = cron("0", "4", "1", "*", "1");
    expect(cronMatches(monthly1stOrMonday, at("2026-09-01T04:00:00"))).toBe(true); // 1er, mardi
    expect(cronMatches(monthly1stOrMonday, at("2026-09-14T04:00:00"))).toBe(true); // lundi
    expect(cronMatches(monthly1stOrMonday, at("2026-09-15T04:00:00"))).toBe(false);
  });

  it("n'applique que le champ contraint quand l'autre vaut étoile", () => {
    expect(cronMatches(cron("0", "4", "*", "*", "1"), at("2026-09-14T04:00:00"))).toBe(true);
    expect(cronMatches(cron("0", "4", "*", "*", "1"), at("2026-09-15T04:00:00"))).toBe(false);
  });
});

describe("prochaine exécution", () => {
  it("est strictement postérieure à l'instant donné", () => {
    // Sinon une tâche qui vient de s'exécuter se replanifierait à la même
    // minute et repartirait en boucle.
    const now = at("2026-09-16T04:00:00");
    expect(nextCronRun(cron("0", "4"), now)?.toISOString()).toBe("2026-09-17T04:00:00.000Z");
  });

  it("remet les secondes à zéro", () => {
    // Garder les secondes ferait dériver l'horaire à chaque replanification.
    const next = nextCronRun(cron("*/5"), at("2026-09-16T04:02:37"));
    expect(next?.toISOString()).toBe("2026-09-16T04:05:00.000Z");
  });

  it("franchit le changement de mois", () => {
    const next = nextCronRun(cron("0", "0", "1"), at("2026-09-16T12:00:00"));
    expect(next?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("rend null pour une date qui ne survient jamais", () => {
    // « 31 février » est syntaxiquement valide. Renvoyer une date approchée
    // ferait exécuter la tâche à un moment que personne n'a demandé.
    expect(nextCronRun(cron("0", "0", "31", "2"))).toBeNull();
  });

  it("refuse une expression invalide au lieu de chercher en vain", () => {
    expect(() => nextCronRun(cron("99"))).toThrow(CronSyntaxError);
  });

  it("valide les cinq champs", () => {
    expect(() => assertValidCron(cron("0", "4", "*", "*", "*"))).not.toThrow();
    expect(() => assertValidCron(cron("0", "4", "*", "*", "9"))).toThrow(CronSyntaxError);
  });
});
