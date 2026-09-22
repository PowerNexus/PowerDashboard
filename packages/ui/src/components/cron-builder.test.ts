import { describe, expect, it } from "vitest";
import { CRON_PRESETS, type CronValue, cronToString, describeCron } from "./cron-builder";

const cron = (
  minute: string,
  hour: string,
  dayOfMonth = "*",
  month = "*",
  dayOfWeek = "*",
): CronValue => ({ minute, hour, dayOfMonth, month, dayOfWeek });

describe("cronToString", () => {
  it("assemble les cinq champs dans l'ordre standard", () => {
    expect(cronToString(cron("0", "4"))).toBe("0 4 * * *");
    expect(cronToString(cron("30", "2", "1", "*", "1"))).toBe("30 2 1 * 1");
  });
});

describe("describeCron", () => {
  it("reconnaît chaque raccourci proposé à l'utilisateur", () => {
    for (const preset of CRON_PRESETS) {
      expect(describeCron(preset.value)).toBe(preset.label);
    }
  });

  it("décrit un intervalle en minutes", () => {
    expect(describeCron(cron("*/5", "*"))).toBe("Toutes les 5 minutes");
  });

  it("décrit une exécution horaire à une minute donnée", () => {
    expect(describeCron(cron("17", "*"))).toBe("À la minute 17 de chaque heure");
  });

  it("complète l'heure sur deux chiffres", () => {
    expect(describeCron(cron("5", "7"))).toBe("À 07h05");
  });
});

describe("CRON_PRESETS", () => {
  it("ne propose que des expressions à cinq champs", () => {
    for (const preset of CRON_PRESETS) {
      expect(cronToString(preset.value).split(" ")).toHaveLength(5);
    }
  });

  it("ne contient pas de doublon", () => {
    const expressions = CRON_PRESETS.map((p) => cronToString(p.value));
    expect(new Set(expressions).size).toBe(expressions.length);
  });
});
