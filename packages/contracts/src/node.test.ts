import { describe, expect, it } from "vitest";
import {
  hasLiveMetrics,
  NODE_HEARTBEAT_LOST_MS,
  NODE_HEARTBEAT_STALE_MS,
  nodeStatus,
} from "./node";

const NOW = new Date("2026-09-15T12:00:00.000Z").getTime();
const heartbeatAgo = (ms: number) => new Date(NOW - ms).toISOString();

describe("nodeStatus", () => {
  it("considère opérationnel un node qui vient d'émettre", () => {
    expect(nodeStatus({ lastHeartbeatAt: heartbeatAgo(2_000), maintenance: false }, NOW)).toBe(
      "online",
    );
  });

  it("signale un retard au-delà du seuil, sans déclarer le node perdu", () => {
    const justOver = NODE_HEARTBEAT_STALE_MS + 1_000;
    expect(nodeStatus({ lastHeartbeatAt: heartbeatAgo(justOver), maintenance: false }, NOW)).toBe(
      "stale",
    );
  });

  it("déclare injoignable au-delà du seuil de perte", () => {
    const lost = NODE_HEARTBEAT_LOST_MS + 1_000;
    expect(nodeStatus({ lastHeartbeatAt: heartbeatAgo(lost), maintenance: false }, NOW)).toBe(
      "unreachable",
    );
  });

  it("affiche la maintenance tant que le daemon répond", () => {
    expect(nodeStatus({ lastHeartbeatAt: heartbeatAgo(5_000), maintenance: true }, NOW)).toBe(
      "maintenance",
    );
  });

  it("fait primer l'absence de heartbeat sur la maintenance déclarée", () => {
    // La maintenance est une intention de l'administrateur ; l'absence de
    // heartbeat est un fait observé. Le fait doit l'emporter, sinon un node
    // réellement tombé pendant une maintenance passerait pour sain.
    const lost = NODE_HEARTBEAT_LOST_MS + 60_000;
    expect(nodeStatus({ lastHeartbeatAt: heartbeatAgo(lost), maintenance: true }, NOW)).toBe(
      "unreachable",
    );
  });

  it("reste opérationnel exactement au seuil de retard", () => {
    expect(
      nodeStatus(
        { lastHeartbeatAt: heartbeatAgo(NODE_HEARTBEAT_STALE_MS), maintenance: false },
        NOW,
      ),
    ).toBe("online");
  });

  it("reste en retard exactement au seuil de perte", () => {
    expect(
      nodeStatus(
        { lastHeartbeatAt: heartbeatAgo(NODE_HEARTBEAT_LOST_MS), maintenance: false },
        NOW,
      ),
    ).toBe("stale");
  });
});

describe("hasLiveMetrics", () => {
  it("n'accorde aucune confiance aux mesures d'un node injoignable", () => {
    expect(hasLiveMetrics("unreachable")).toBe(false);
  });

  it("accepte les mesures dans tous les autres états", () => {
    expect(hasLiveMetrics("online")).toBe(true);
    expect(hasLiveMetrics("stale")).toBe(true);
    expect(hasLiveMetrics("maintenance")).toBe(true);
  });
});
