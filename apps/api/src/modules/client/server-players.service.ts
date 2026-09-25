import {
  effectivePlayerCommands,
  isPlayerAction,
  PLAYER_ACTIONS,
  type PlayerAction,
  type PlayerCommands,
  RUNTIME_STATE_FRESH_WINDOW,
  readPlayerCommands,
  renderPlayerCommand,
} from "@gamedashboard/contracts";
import { type Database, eggs, nests, serverHealth, servers } from "@gamedashboard/db";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { detectRuntime } from "../marketplace/server-runtime";

/** Ce que la page Joueurs affiche. */
export interface PlayersView {
  /** `null` : aucune sonde récente n'a su lire le compteur. */
  online: number | null;
  max: number | null;
  /**
   * Noms connus. **Un échantillon** : Minecraft n'en donne qu'une douzaine au
   * plus. `null` quand la sonde n'en a reçu aucun.
   */
  sample: string[] | null;
  /** Vrai quand l'échantillon couvre tous les joueurs connectés. */
  complete: boolean;
  /** Instant de la sonde lue, `null` sans sonde récente. */
  observedAt: string | null;
  /** Actions possibles, dans l'ordre de `PLAYER_ACTIONS`. */
  actions: PlayerAction[];
}

/**
 * Vue joueurs : lecture de la dernière sonde et fabrication des commandes.
 *
 * Il ne parle ni au jeu ni au daemon : l'envoi reste au contrôleur, qui garde
 * déjà le relais vers Wings et le journal. Ce qui est ici se teste contre une
 * base, sans node.
 */
@Injectable()
export class ServerPlayersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async view(serverId: string): Promise<PlayersView> {
    const commands = await this.commandsOf(serverId);

    const [probe] = await this.db
      .select({ at: serverHealth.at, payload: serverHealth.queryPayload })
      .from(serverHealth)
      .where(
        and(
          eq(serverHealth.serverId, serverId),
          eq(serverHealth.reachable, true),
          // Même fenêtre que le compteur de la liste des serveurs : deux écrans
          // ne doivent pas se contredire sur le même serveur.
          gt(serverHealth.at, sql`now() - ${RUNTIME_STATE_FRESH_WINDOW}::interval`),
        ),
      )
      .orderBy(desc(serverHealth.at))
      .limit(1);

    const payload = (probe?.payload ?? {}) as {
      playersOnline?: unknown;
      playersMax?: unknown;
      sample?: unknown;
    };
    const online = typeof payload.playersOnline === "number" ? payload.playersOnline : null;
    const sample = Array.isArray(payload.sample)
      ? payload.sample.filter((name): name is string => typeof name === "string")
      : null;

    return {
      online,
      max: typeof payload.playersMax === "number" ? payload.playersMax : null,
      sample,
      complete: sample !== null && online !== null && sample.length >= online,
      observedAt: probe?.at ?? null,
      actions: PLAYER_ACTIONS.filter((action) => commands[action] !== undefined),
    };
  }

  /**
   * La commande à taper, ou un refus qui dit pourquoi.
   *
   * Le nom n'est pas vérifié contre l'échantillon : bannir un joueur déconnecté
   * est l'usage le plus courant, et l'échantillon est de toute façon partiel.
   */
  async command(serverId: string, action: unknown, player: unknown, reason: unknown) {
    if (!isPlayerAction(action)) throw new BadRequestException("Action inconnue.");
    const template = (await this.commandsOf(serverId))[action];
    if (!template) {
      throw new BadRequestException("Ce jeu ne déclare pas de commande pour cette action.");
    }
    const command = renderPlayerCommand(
      template,
      typeof player === "string" ? player : "",
      typeof reason === "string" ? reason : undefined,
    );
    if (command === null) {
      throw new BadRequestException(
        "Nom de joueur invalide : lettres, chiffres, « _ », « . » et « - » seulement, 32 au plus.",
      );
    }
    return { action, player: player as string, command };
  }

  /** Commandes de l'egg, ou celles du jeu reconnu à son nom (voir `effectivePlayerCommands`). */
  private async commandsOf(serverId: string): Promise<PlayerCommands> {
    const [row] = await this.db
      .select({ declared: eggs.playerCommands, eggName: eggs.name, nestName: nests.name })
      .from(servers)
      .innerJoin(eggs, eq(servers.eggId, eggs.id))
      .innerJoin(nests, eq(eggs.nestId, nests.id))
      .where(eq(servers.id, serverId))
      .limit(1);
    if (!row) throw new NotFoundException("Serveur introuvable.");

    // Même reconnaissance que la sonde de jeu : par le nom, sans les variables.
    const game = detectRuntime(row.eggName, row.nestName, {})?.game ?? null;
    return effectivePlayerCommands(readPlayerCommands(row.declared), game);
  }
}
