import { describe, expect, it } from "vitest";
import {
  LAST_SEEN_PRECISION_MS,
  SESSION_IDLE_MS,
  SESSION_TTL_MS,
  sessionTimedOut,
  shouldRecordLastSeen,
} from "./session.repository";

const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("shouldRecordLastSeen", () => {
  it("inscrit une session jamais vue", () => {
    // Le cas des sessions ouvertes avant l'existence de la colonne : sans
    // cette branche, elles resteraient à « jamais » indéfiniment.
    expect(shouldRecordLastSeen(null, NOW)).toBe(true);
  });

  it("n'écrit pas deux fois dans la même tranche", () => {
    expect(shouldRecordLastSeen(at(LAST_SEEN_PRECISION_MS - 1), NOW)).toBe(false);
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

/**
 * Durée de vie d'une session (NC-03, ASVS 3.3.2 niveau 2) : trente minutes
 * d'inactivité, douze heures au plus. Elle durait sept jours, sans aucune
 * expiration d'inactivité — `last_seen_at` était écrit mais jamais lu.
 */
describe("sessionTimedOut", () => {
  const opened = (msAgo: number, seenMsAgo: number | null) => ({
    createdAt: at(msAgo),
    lastSeenAt: seenMsAgo === null ? null : at(seenMsAgo),
  });

  it("garde une session servie récemment", () => {
    expect(sessionTimedOut(opened(0, 0), NOW)).toBe(false);
    expect(sessionTimedOut(opened(3 * 3600_000, SESSION_IDLE_MS - 1), NOW)).toBe(false);
  });

  it("refuse une session inactive depuis trente minutes", () => {
    expect(SESSION_IDLE_MS).toBe(30 * 60_000);
    expect(sessionTimedOut(opened(3 * 3600_000, SESSION_IDLE_MS), NOW)).toBe(true);
    expect(sessionTimedOut(opened(3 * 3600_000, 2 * 3600_000), NOW)).toBe(true);
  });

  it("compte l'inactivité depuis l'ouverture quand la session n'a jamais été vue", () => {
    expect(sessionTimedOut(opened(SESSION_IDLE_MS - 1, null), NOW)).toBe(false);
    expect(sessionTimedOut(opened(SESSION_IDLE_MS, null), NOW)).toBe(true);
  });

  it("refuse une session ouverte depuis douze heures, même active", () => {
    expect(SESSION_TTL_MS).toBe(12 * 3600_000);
    expect(sessionTimedOut(opened(SESSION_TTL_MS - 1, 0), NOW)).toBe(false);
    expect(sessionTimedOut(opened(SESSION_TTL_MS, 0), NOW)).toBe(true);
    // Une session ouverte sous l'ancienne règle, `expires_at` à sept jours,
    // tombe aussi : la limite se lit sur l'ouverture, pas sur `expires_at`.
    expect(sessionTimedOut(opened(3 * 24 * 3600_000, 0), NOW)).toBe(true);
  });

  it("ne tient pas pour inactive une session vue « dans le futur »", () => {
    // Horloge corrigée : `touch` réécrira la valeur ; la refuser d'ici là
    // déconnecterait quelqu'un en pleine activité.
    expect(sessionTimedOut(opened(3600_000, -60_000), NOW)).toBe(false);
  });

  it("refuse une ouverture illisible plutôt que de la croire éternelle", () => {
    expect(sessionTimedOut({ createdAt: "pas une date", lastSeenAt: at(0) }, NOW)).toBe(true);
  });

  /**
   * La granularité de `last_seen_at` ne doit pas déplacer la limite.
   *
   * La colonne n'est réécrite qu'une fois par tranche de précision : la
   * dernière valeur écrite peut précéder la dernière requête d'autant. La
   * limite se lisant sur la valeur écrite, une précision de cinq minutes
   * déconnectait après vingt-cinq minutes d'inactivité réelle. L'écart doit
   * rester sous la minute, quelle que soit la cadence des requêtes.
   */
  it("refuse entre vingt-neuf et trente minutes d'inactivité réelle", () => {
    for (const cadence of [1_000, 20_000, 59_000, 61_000, 4 * 60_000, 7 * 60_000]) {
      let recorded = NOW;
      let last = NOW;
      for (let t = NOW; t <= NOW + 40 * 60_000; t += cadence) {
        const session = { createdAt: at(0), lastSeenAt: new Date(recorded).toISOString() };
        expect(sessionTimedOut(session, t)).toBe(false);
        if (shouldRecordLastSeen(session.lastSeenAt, t)) recorded = t;
        last = t;
      }

      const session = { createdAt: at(0), lastSeenAt: new Date(recorded).toISOString() };
      let refusedAt = last;
      while (!sessionTimedOut(session, refusedAt)) refusedAt += 1_000;

      expect(refusedAt - last).toBeLessThanOrEqual(SESSION_IDLE_MS);
      expect(refusedAt - last).toBeGreaterThan(SESSION_IDLE_MS - 60_000);
    }
  });
});
