import { describe, expect, it } from "vitest";
import {
  isWebhookEvent,
  parseWebhookSignature,
  WEBHOOK_EVENT_CATALOGUE,
  WEBHOOK_EVENTS,
  WEBHOOK_MAX_ATTEMPTS,
  webhookRetryDelayMs,
  webhookShouldRetry,
  webhookSignatureHeader,
  webhookSignaturePayload,
} from "./webhooks";

describe("isWebhookEvent", () => {
  it("reconnaît un événement du catalogue", () => {
    expect(isWebhookEvent("server.installed")).toBe(true);
  });

  it("refuse un événement inventé", () => {
    expect(isWebhookEvent("server.exploded")).toBe(false);
  });
});

describe("WEBHOOK_EVENT_CATALOGUE", () => {
  it("décrit exactement les événements émis", () => {
    // Un événement absent du catalogue est émis par le panel mais impossible à
    // cocher : il n'arrive donc chez personne.
    const listed = WEBHOOK_EVENT_CATALOGUE.flatMap((group) =>
      group.events.map((entry) => entry.event),
    ).sort();
    expect(listed).toEqual([...WEBHOOK_EVENTS].sort());
  });
});

describe("signature", () => {
  it("signe l'horodatage avec le corps", () => {
    // Signer le corps seul rendrait la livraison rejouable pour toujours.
    expect(webhookSignaturePayload(1700000000, '{"a":1}')).toBe('1700000000.{"a":1}');
  });

  it("produit un en-tête versionné", () => {
    expect(webhookSignatureHeader(1700000000, "abc")).toBe("t=1700000000,v1=abc");
  });

  it("relit ce qu'il a écrit", () => {
    const header = webhookSignatureHeader(1700000000, "abc");
    expect(parseWebhookSignature(header)).toEqual({ timestampSeconds: 1700000000, v1: "abc" });
  });

  it("tolère des espaces autour des séparateurs", () => {
    expect(parseWebhookSignature("t=42, v1=deadbeef")).toEqual({
      timestampSeconds: 42,
      v1: "deadbeef",
    });
  });

  it("refuse un en-tête amputé", () => {
    // Sans horodatage, rien ne borne l'âge de la livraison.
    expect(parseWebhookSignature("v1=abc")).toBeNull();
    expect(parseWebhookSignature("t=1700000000")).toBeNull();
    expect(parseWebhookSignature("n'importe quoi")).toBeNull();
  });
});

describe("webhookRetryDelayMs", () => {
  it("croît d'une tentative à l'autre", () => {
    const delays = Array.from({ length: WEBHOOK_MAX_ATTEMPTS - 1 }, (_, i) =>
      webhookRetryDelayMs(i + 1),
    );
    expect(delays.every((d) => d !== null)).toBe(true);

    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1] as number);
    }
  });

  it("renonce après la dernière tentative", () => {
    // `null` est une issue normale : un point d'entrée mort cesse d'être appelé
    // plutôt que de remplir la table indéfiniment.
    expect(webhookRetryDelayMs(WEBHOOK_MAX_ATTEMPTS)).toBeNull();
    expect(webhookRetryDelayMs(999)).toBeNull();
  });

  it("refuse une tentative absurde plutôt que de rendre le premier délai", () => {
    expect(webhookRetryDelayMs(0)).toBeNull();
    expect(webhookRetryDelayMs(-3)).toBeNull();
  });
});

describe("webhookShouldRetry", () => {
  it("retente quand aucune réponse n'est parvenue", () => {
    // Panne réseau : la condition est temporaire par nature.
    expect(webhookShouldRetry(null)).toBe(true);
  });

  it("retente sur une panne du receveur", () => {
    expect(webhookShouldRetry(500)).toBe(true);
    expect(webhookShouldRetry(503)).toBe(true);
  });

  it("ne retente pas sur une erreur de l'appelé qui se reproduira à l'identique", () => {
    // Un 404 pendant vingt-quatre heures masque une URL fausse derrière une
    // file qui s'allonge.
    expect(webhookShouldRetry(404)).toBe(false);
    expect(webhookShouldRetry(400)).toBe(false);
    expect(webhookShouldRetry(403)).toBe(false);
  });

  it("retente sur les deux 4xx qui disent « plus tard »", () => {
    expect(webhookShouldRetry(408)).toBe(true);
    expect(webhookShouldRetry(429)).toBe(true);
  });

  it("ne retente pas un succès", () => {
    expect(webhookShouldRetry(200)).toBe(false);
    expect(webhookShouldRetry(204)).toBe(false);
  });
});
