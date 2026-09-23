import { describe, expect, it } from "vitest";
import {
  METRICS_RANGE_SPEC,
  METRICS_RANGES,
  MetricsRange,
  metricsBuckets,
  metricsPointCount,
  metricsStepSeconds,
} from "./metrics-history";

describe("pas de l'historique des mesures", () => {
  it("choisit un pas adapté à chaque plage", () => {
    expect(metricsStepSeconds("1h")).toBe(60);
    expect(metricsStepSeconds("24h")).toBe(5 * 60);
    expect(metricsStepSeconds("7d")).toBe(60 * 60);
    expect(metricsStepSeconds("30d")).toBe(4 * 60 * 60);
  });

  it("reste autour de quelques centaines de points, jamais les 43 200 lignes brutes", () => {
    for (const range of METRICS_RANGES) {
      const points = metricsPointCount(range);
      expect(points, range).toBeGreaterThanOrEqual(60);
      expect(points, range).toBeLessThanOrEqual(400);
    }
  });

  it("découpe chaque plage en un nombre entier de pas", () => {
    // Un reste ferait un dernier pas tronqué, qui se lirait comme une chute.
    for (const range of METRICS_RANGES) {
      expect(Number.isInteger(metricsPointCount(range)), range).toBe(true);
    }
  });

  it("ne descend jamais sous la cadence du relevé, qui est la minute", () => {
    // Un pas plus fin que le relevé produirait un trou sur deux, dessiné comme
    // une panne qui n'a pas eu lieu.
    for (const range of METRICS_RANGES) {
      expect(METRICS_RANGE_SPEC[range].stepSeconds, range).toBeGreaterThanOrEqual(60);
    }
  });

  it("aligne les pas sur l'époque, et finit sur le pas qui contient l'instant", () => {
    const now = new Date("2026-03-01T12:07:42.000Z");
    const heure = metricsBuckets("24h", now);
    expect(heure.last.toISOString()).toBe("2026-03-01T12:05:00.000Z");
    expect(heure.first.toISOString()).toBe("2026-02-28T12:10:00.000Z");
    expect(heure.count).toBe(288);

    const mois = metricsBuckets("30d", now);
    // Quatre heures depuis l'époque : 12 h est une borne, 12 h 07 tombe dedans.
    expect(mois.last.toISOString()).toBe("2026-03-01T12:00:00.000Z");
    expect((mois.last.getTime() - mois.first.getTime()) / 1000).toBe(
      (mois.count - 1) * mois.stepSeconds,
    );
  });

  it("rend les mêmes pas à deux lectures rapprochées", () => {
    // Sinon la courbe glisse à chaque rafraîchissement.
    const a = metricsBuckets("7d", new Date("2026-03-01T12:00:10.000Z"));
    const b = metricsBuckets("7d", new Date("2026-03-01T12:40:00.000Z"));
    expect(a.first.getTime()).toBe(b.first.getTime());
  });

  it("refuse une plage inconnue", () => {
    expect(MetricsRange.safeParse("90d").success).toBe(false);
    expect(MetricsRange.safeParse("7d").success).toBe(true);
  });
});
