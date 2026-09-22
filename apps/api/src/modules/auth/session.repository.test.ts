import { describe, expect, it } from "vitest";
import { LAST_SEEN_PRECISION_MS, shouldRecordLastSeen } from "./session.repository";

const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("shouldRecordLastSeen", () => {
  it("inscrit une session jamais vue", () => {
    // Le cas des sessions ouvertes avant l'existence de la colonne : sans
    // cette branche, elles resteraient à « jamais » indéfiniment.
    expect(shouldRecordLastSeen(null, NOW)).toBe(true);
  });

  it("n'écrit pas deux fois dans la même tranche", () => {
    expect(shouldRecordLastSeen(at(60_000), NOW)).toBe(false);
  });

  it("écrit une fois la tranche écoulée", () => {
    expect(shouldRecordLastSeen(at(LAST_SEEN_PRECISION_MS), NOW)).toBe(true);
    expect(shouldRecordLastSeen(at(LAST_SEEN_PRECISION_MS + 1), NOW)).toBe(true);
  });

  it("écrit malgré une date future", () => {
    // Horloge corrigée ou réplique en avance : sans cette branche, la colonne
    // resterait figée jusqu'à ce que le présent rattrape la valeur écrite.
    expect(shouldRecordLastSeen(at(-3600_000), NOW)).toBe(true);
  });

  it("écrit malgré une valeur illisible", () => {
    // Toute comparaison avec NaN étant fausse, un test naïf gèlerait la
    // colonne pour de bon sur une ligne abîmée.
    expect(shouldRecordLastSeen("pas une date", NOW)).toBe(true);
  });
});
