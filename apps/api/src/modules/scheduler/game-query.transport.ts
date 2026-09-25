import { createSocket } from "node:dgram";
import { request } from "node:http";
import { isIPv6 } from "node:net";
import {
  type A2sInfo,
  a2sStatus,
  buildInfoRequest,
  buildPlayerRequest,
  readA2sResponse,
} from "./a2s-query";
import { type CfxInfo, cfxStatus, parseCfxInfo, parseCfxPlayers } from "./cfx-query";
import type { GameStatus } from "./game-status";

/**
 * Les sockets des sondes A2S et Cfx.re.
 *
 * Même règle que pour Minecraft (`ping`) : `null` dès que quelque chose
 * cloche — délai, port fermé, interlocuteur qui ne parle pas le protocole.
 * Aucun de ces cas n'est distingué, parce qu'aucun ne change ce qu'il faut en
 * dire : les joueurs n'entrent pas.
 */

/** Délai accordé à un serveur pour répondre, comme pour Minecraft. */
export const QUERY_TIMEOUT_MS = 3_000;

/**
 * Défis acceptés d'affilée pour une même demande. Un serveur honnête n'en
 * envoie qu'un ; au-delà, il nous fait tourner en rond.
 */
const MAX_CHALLENGES = 2;

/** Au-delà, un datagramme n'est pas une réponse A2S : il est ignoré. */
const MAX_DATAGRAM_BYTES = 16 * 1024;

/**
 * Sonde A2S : information, puis liste des joueurs.
 *
 * L'information seule décide de la joignabilité. La liste des joueurs est un
 * supplément : un serveur qui la refuse, la découpe en plusieurs datagrammes
 * ou tarde à l'envoyer reste joignable, simplement sans noms (`sample: null`).
 */
export function queryA2s(
  host: string,
  port: number,
  timeoutMs = QUERY_TIMEOUT_MS,
): Promise<GameStatus | null> {
  return new Promise((resolve) => {
    const socket = createSocket(isIPv6(host) ? "udp6" : "udp4");
    let settled = false;
    let info: A2sInfo | null = null;
    let challenges = 0;

    const finish = (status: GameStatus | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Déjà fermée par une erreur : rien à libérer.
      }
      resolve(status);
    };
    // Ce qu'on sait quand la suite fait défaut : l'information, sans noms.
    const giveUp = (): void => finish(info ? a2sStatus(info, null) : null);
    const send = (packet: Buffer): void => {
      socket.send(packet, (error) => {
        if (error) giveUp();
      });
    };

    const timer = setTimeout(giveUp, timeoutMs);
    // Port fermé : la machine répond « inaccessible », et la socket connectée
    // le remonte en erreur — on conclut sans attendre le délai.
    socket.on("error", giveUp);

    socket.on("message", (datagram) => {
      if (datagram.length > MAX_DATAGRAM_BYTES) return;
      const response = readA2sResponse(datagram);
      if (response === null) return;

      if (response.kind === "split") {
        giveUp();
      } else if (response.kind === "challenge") {
        challenges += 1;
        if (challenges > MAX_CHALLENGES) return giveUp();
        // Le défi vaut pour la demande en cours : information tant qu'on ne
        // l'a pas, joueurs ensuite.
        send(info ? buildPlayerRequest(response.challenge) : buildInfoRequest(response.challenge));
      } else if (response.kind === "info" && info === null) {
        info = response.info;
        challenges = 0;
        send(buildPlayerRequest());
      } else if (response.kind === "players" && info !== null) {
        finish(a2sStatus(info, response.names));
      }
    });

    // `connect` filtre les datagrammes : seuls ceux de l'adresse sondée sont
    // lus, un tiers ne peut pas glisser sa réponse.
    socket.connect(port, host, () => send(buildInfoRequest()));
  });
}

/** Taille maximale de `/info.json` : la liste des ressources peut être longue. */
const CFX_INFO_MAX_BYTES = 256 * 1024;
/** Taille maximale de `/players.json` : chaque joueur y porte ses identifiants. */
const CFX_PLAYERS_MAX_BYTES = 1024 * 1024;

/**
 * Sonde Cfx.re : `/info.json` décide de la joignabilité, `/players.json`
 * donne le compteur et les noms. Les deux partent ensemble.
 */
export async function queryCfx(
  host: string,
  port: number,
  timeoutMs = QUERY_TIMEOUT_MS,
): Promise<GameStatus | null> {
  const [infoBody, playersBody] = await Promise.all([
    httpGet(host, port, "/info.json", CFX_INFO_MAX_BYTES, timeoutMs),
    httpGet(host, port, "/players.json", CFX_PLAYERS_MAX_BYTES, timeoutMs),
  ]);
  const info: CfxInfo | null = infoBody === null ? null : parseCfxInfo(infoBody);
  if (info === null) return null;
  return cfxStatus(info, playersBody === null ? null : parseCfxPlayers(playersBody));
}

/**
 * `GET` en HTTP clair, borné en temps et en taille, sans redirection.
 *
 * `fetch` lirait le corps en entier avant qu'on puisse le borner : un serveur
 * de jeu, contrôlé par le client, pourrait faire enfler la mémoire du panel.
 */
export function httpGet(
  host: string,
  port: number,
  path: string,
  maxBytes: number,
  timeoutMs = QUERY_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (body: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      resolve(body);
    };

    const req = request(
      {
        host,
        port,
        path,
        method: "GET",
        // Une connexion par sonde, fermée aussitôt : rien à garder ouvert.
        agent: false,
        headers: { accept: "application/json", "user-agent": "GameDashboard-sonde" },
      },
      (res) => {
        const declared = Number(res.headers["content-length"] ?? 0);
        if (res.statusCode !== 200 || declared > maxBytes) return finish(null);

        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) return finish(null);
          chunks.push(chunk);
        });
        res.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
        res.on("error", () => finish(null));
      },
    );

    const timer = setTimeout(() => finish(null), timeoutMs);
    req.on("error", () => finish(null));
    req.end();
  });
}
