import type { Database } from "@gamedashboard/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebhookDispatcherService } from "./webhook-dispatcher.service";
import type { DueDelivery, WebhookQueue } from "./webhook-queue";

vi.mock("../../common/row-secrets", () => ({ decryptRowSecret: () => "secret" }));

/**
 * Rappels vers Discord : le corps générique y était refusé (400) à chaque
 * envoi, alors que l'écran des rappels propose une adresse Discord en exemple.
 */

function livraison(url: string): DueDelivery {
  return {
    id: "d-1",
    webhookId: "w-1",
    url,
    event: "server.unreachable",
    payload: {
      event: "server.unreachable",
      server: { id: "s-1", name: "Survie", shortId: "ab12cd34" },
      occurredAt: "2026-09-25T10:00:00.000Z",
    },
    secretEnc: "v4:chiffre",
    attempts: 0,
  } as DueDelivery;
}

async function envoyer(url: string): Promise<Record<string, unknown>> {
  const envoye = vi.fn(
    async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }),
  );
  vi.stubGlobal("fetch", envoye);
  const file = {
    label: "client",
    claimDue: vi.fn(async () => [livraison(url)]),
    settle: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    touch: vi.fn(async () => {}),
  };
  const repartiteur = new WebhookDispatcherService({} as Database);
  (repartiteur as unknown as { queues: WebhookQueue[] }).queues = [file as unknown as WebhookQueue];

  await repartiteur.tick();
  expect(file.settle).toHaveBeenCalledWith("d-1", expect.anything(), "delivered");
  const init = envoye.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("répartiteur : format Discord", () => {
  it("traduit le rappel pour une adresse Discord", async () => {
    const corps = await envoyer("https://discord.com/api/webhooks/1/abc");
    expect(corps.content).toBe("**Serveur injoignable** · Survie (ab12cd34)");
    expect(corps.allowed_mentions).toEqual({ parse: [] });
  });

  it("garde le format signé pour tout autre receveur", async () => {
    const corps = await envoyer("https://exemple.fr/rappel");
    expect(corps).toMatchObject({ event: "server.unreachable", server: { name: "Survie" } });
    expect(corps.content).toBeUndefined();
  });
});
