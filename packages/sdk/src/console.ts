import type { GameDashboardClient } from "./client";

/**
 * La console d'un serveur, en direct.
 *
 * **Le flux ne passe pas par le panel.** Le client lui demande un jeton, puis
 * ouvre un websocket **directement sur le daemon** : relayer une console par
 * le panel en ferait un goulot d'étranglement, et le rendrait responsable
 * d'une panne qui n'est pas la sienne.
 *
 * Deux choses que le protocole de Wings impose, et qu'on oublie la première
 * fois :
 *
 * 1. **l'historique ne vient pas tout seul.** Après `auth success`, il faut
 *    demander `send logs`, sinon la console reste vide jusqu'à la ligne
 *    suivante — ce qui ressemble à un serveur muet ;
 * 2. **le jeton dure dix minutes** et le daemon prévient avant l'échéance. Ne
 *    pas écouter `token expiring` fait couper la console en pleine lecture,
 *    sans message.
 *
 * L'envoi de commandes passe en revanche **par le panel** et non par la
 * socket : c'est lui qui vérifie la permission et qui consigne la commande au
 * journal du serveur. Wings accepterait `send command` sur la socket, mais
 * rien n'en garderait trace.
 */

export interface ConsoleEvent {
  kind: "output" | "install" | "status" | "stats" | "error";
  /** La ligne, l'état, ou le message d'erreur selon `kind`. */
  text: string;
}

export interface ServerConsole {
  /** Envoie une commande, par le panel — donc consignée. */
  send(command: string): Promise<void>;
  close(): void;
}

interface Payload {
  event?: string;
  args?: (string | null)[];
}

/**
 * Ouvre la console d'un serveur.
 *
 * `WebSocket` est pris dans l'environnement : Node 24 en a un natif, un
 * navigateur aussi. Le passer en option reste possible pour un environnement
 * qui n'en aurait pas, ou pour un test.
 */
export async function openServerConsole(
  client: GameDashboardClient,
  serverId: string,
  onEvent: (event: ConsoleEvent) => void,
  options: { WebSocketImpl?: typeof WebSocket } = {},
): Promise<ServerConsole> {
  const Impl = options.WebSocketImpl ?? globalThis.WebSocket;
  if (!Impl) throw new Error("Aucune implémentation de WebSocket dans cet environnement.");

  const grant = (await client.websocketGrant(serverId)) as { token: string; socket: string };
  const socket = new Impl(grant.socket);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ event: "auth", args: [grant.token] }));
  });

  socket.addEventListener("message", (message: MessageEvent) => {
    const payload = lire(message.data);
    if (!payload?.event) return;

    switch (payload.event) {
      case "auth success":
        // Sans cette demande, la console reste vide : le daemon n'envoie
        // l'historique que si on le réclame.
        socket.send(JSON.stringify({ event: "send logs", args: [null] }));
        break;
      case "console output":
      case "install output":
        for (const ligne of payload.args ?? []) {
          if (ligne !== null) {
            onEvent({
              kind: payload.event === "install output" ? "install" : "output",
              text: ligne,
            });
          }
        }
        break;
      case "status":
        onEvent({ kind: "status", text: payload.args?.[0] ?? "" });
        break;
      case "stats":
        onEvent({ kind: "stats", text: payload.args?.[0] ?? "" });
        break;
      case "token expiring":
      case "token expired":
        void renouveler(client, serverId, socket);
        break;
      case "jwt error":
      case "daemon error":
        onEvent({ kind: "error", text: payload.args?.[0] ?? payload.event });
        break;
    }
  });

  return {
    send: (command) => client.command(serverId, command).then(() => undefined),
    close: () => socket.close(),
  };
}

/**
 * Redemande un jeton et le présente sur la socket **déjà ouverte**.
 *
 * Rouvrir la connexion perdrait l'historique affiché et ferait clignoter la
 * console à chaque renouvellement, c'est-à-dire toutes les dix minutes.
 */
async function renouveler(
  client: GameDashboardClient,
  serverId: string,
  socket: WebSocket,
): Promise<void> {
  try {
    const grant = (await client.websocketGrant(serverId)) as { token: string };
    socket.send(JSON.stringify({ event: "auth", args: [grant.token] }));
  } catch {
    // Le daemon coupera de lui-même à l'échéance ; l'appelant le verra par un
    // `jwt error`. Inventer un message ici dirait deux fois la même chose.
  }
}

function lire(data: unknown): Payload | null {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as Payload;
  } catch {
    return null;
  }
}
