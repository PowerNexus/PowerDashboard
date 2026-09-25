import { describe, expect, it } from "vitest";
import { discordWebhookBody, isDiscordWebhookUrl } from "./discord-webhook";

describe("isDiscordWebhookUrl", () => {
  it.each([
    "https://discord.com/api/webhooks/1/abc",
    "https://discordapp.com/api/webhooks/1/abc",
    "https://canary.discord.com/api/webhooks/1/abc",
  ])("reconnaît %s", (url) => {
    expect(isDiscordWebhookUrl(url)).toBe(true);
  });

  it.each([
    "http://discord.com/api/webhooks/1/abc",
    "https://discord.com.exemple.fr/api/webhooks/1/abc",
    "https://exemple.fr/api/webhooks/1/abc",
    "https://discord.com/channels/1",
    "pas une adresse",
  ])("écarte %s", (url) => {
    expect(isDiscordWebhookUrl(url)).toBe(false);
  });
});

describe("discordWebhookBody", () => {
  it("annonce l'événement et le serveur, sans résoudre de mention", () => {
    const corps = discordWebhookBody("server.unreachable", {
      event: "server.unreachable",
      server: { id: "x", name: "@everyone", shortId: "ab12cd34" },
      occurredAt: "2026-09-25T10:00:00.000Z",
    });
    expect(corps.content).toBe("**Serveur injoignable** · @everyone (ab12cd34)");
    expect(corps.allowed_mentions).toEqual({ parse: [] });
    expect(corps.embeds[0]).toMatchObject({
      title: "Serveur injoignable",
      timestamp: "2026-09-25T10:00:00.000Z",
    });
  });

  it("garde un événement inconnu lisible", () => {
    const corps = discordWebhookBody("server.created", { at: "2026-09-25T10:00:00.000Z" });
    expect(corps.content).toBe("**server.created**");
    expect(corps.embeds[0]?.description).toContain("server.created");
  });
});
