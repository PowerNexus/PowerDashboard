import { describe, expect, it } from "vitest";
import { RETENTION_RULES } from "./retention.service";

const byTable = new Map(RETENTION_RULES.map((rule) => [rule.table, rule]));

describe("fenêtres de rétention", () => {
  it("couvre les tables qui grossissent à chaque minute", () => {
    // Ce sont celles qui provoquent la panne : une ligne par serveur et par
    // minute, sans fin. Les oublier annulerait l'intérêt de tout le service.
    expect(byTable.has("server_metrics")).toBe(true);
    expect(byTable.has("server_health")).toBe(true);
  });

  it("garde l'audit bien plus longtemps que les mesures", () => {
    /*
     * Un audit se lit des mois après les faits ; une courbe de consommation,
     * non. Les tailler pareil rendrait le journal inutile précisément dans les
     * cas où on l'ouvre.
     */
    const audit = byTable.get("activity_logs");
    const metrics = byTable.get("server_metrics");
    expect(audit?.days).toBeGreaterThan(metrics?.days ?? 0);
  });

  it("n'efface jamais une notification non lue", () => {
    // Elle est encore due à quelqu'un : l'effacer reviendrait à décider à sa
    // place qu'il ne la lira pas.
    expect(byTable.get("notifications")?.where).toBe("read_at is not null");
  });

  it("n'efface jamais une livraison encore en attente", () => {
    // Le tiers ignore qu'il devait la recevoir : personne ne réclamerait un
    // rappel supprimé avant d'avoir abouti.
    expect(byTable.get("application_webhook_deliveries")?.where).toBe("next_attempt_at is null");
  });

  it("n'efface jamais une session encore valable", () => {
    // Elle est ouverte sur l'appareil de quelqu'un, quel que soit son âge.
    expect(byTable.get("sessions")?.where).toContain("revoked_at is not null");
  });

  it("donne une raison à chaque fenêtre", () => {
    // Une durée sans justification se change à la légère, puis se change dans
    // l'autre sens six mois plus tard.
    for (const rule of RETENTION_RULES) {
      expect(rule.reason, rule.table).not.toBe("");
      expect(rule.days, rule.table).toBeGreaterThan(0);
    }
  });

  it("ne vise aucune table deux fois", () => {
    // Deux règles sur la même table, c'est la plus courte qui gagne en
    // silence — et l'autre qui ment.
    const tables = RETENTION_RULES.map((rule) => rule.table);
    expect(new Set(tables).size).toBe(tables.length);
  });
});
