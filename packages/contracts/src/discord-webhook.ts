import { CLIENT_WEBHOOK_CATALOGUE } from "./client-webhooks";

/**
 * Rappels vers un salon Discord.
 *
 * L'écran des rappels d'un serveur propose depuis toujours une adresse
 * Discord en exemple, et c'est l'usage le plus courant : prévenir un salon
 * quand le serveur tombe. Mais le panel envoyait son corps générique
 * `{ event, server, occurredAt }`, que Discord refuse (400 : il attend
 * `content` ou `embeds`). Chaque rappel finissait abandonné.
 *
 * Le corps est donc **traduit** quand l'adresse est un webhook Discord, et
 * seulement dans ce cas : les autres receveurs gardent le format signé qu'ils
 * vérifient.
 */

const DISCORD_HOSTS = new Set([
  "discord.com",
  "discordapp.com",
  "canary.discord.com",
  "ptb.discord.com",
]);

/** Vrai pour une adresse `https://discord.com/api/webhooks/…` et ses variantes. */
export function isDiscordWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      DISCORD_HOSTS.has(parsed.hostname) &&
      parsed.pathname.startsWith("/api/webhooks/")
    );
  } catch {
    return false;
  }
}

export interface DiscordWebhookBody {
  content: string;
  embeds: { title: string; description: string; timestamp?: string }[];
  /**
   * Aucune mention résolue. Le nom du serveur est choisi par son
   * propriétaire, ou par un sous-utilisateur : sans cette garde, un serveur
   * nommé « @everyone » ferait sonner tout le salon à chaque rappel.
   */
  allowed_mentions: { parse: [] };
}

/** Traduit un rappel du panel en message Discord. */
export function discordWebhookBody(event: string, payload: unknown): DiscordWebhookBody {
  const known = CLIENT_WEBHOOK_CATALOGUE.find((entry) => entry.event === event);
  const title = known?.label ?? event;
  const data = (payload ?? {}) as {
    server?: { name?: unknown; shortId?: unknown };
    occurredAt?: unknown;
    at?: unknown;
  };
  const name = typeof data.server?.name === "string" ? data.server.name : null;
  const shortId = typeof data.server?.shortId === "string" ? data.server.shortId : null;
  const when =
    typeof data.occurredAt === "string"
      ? data.occurredAt
      : typeof data.at === "string"
        ? data.at
        : undefined;

  const subject = name ? `${name}${shortId ? ` (${shortId})` : ""}` : null;
  return {
    content: subject ? `**${title}** · ${subject}` : `**${title}**`,
    embeds: [
      {
        title,
        description: known?.description ?? `Événement \`${event}\`.`,
        ...(when ? { timestamp: when } : {}),
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
