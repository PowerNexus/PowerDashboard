import { Socket } from "node:net";
import {
  MISSES_BEFORE_ALERT,
  outageDuration,
  reachabilityTransition,
} from "@gamedashboard/contracts";
import {
  allocations,
  type Database,
  eggs,
  nests,
  nodes,
  serverHealth,
  servers,
} from "@gamedashboard/db";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { and, desc, eq, gte, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { battre } from "../../common/background-tick";
import { DATABASE } from "../../common/database.provider";
import { detectRuntime } from "../marketplace/server-runtime";
import { NotificationsService } from "../notifications/notifications.service";
import { buildStatusRequest, type MinecraftStatus, readStatusResponse } from "./minecraft-ping";

/**
 * La sonde de jeu : le serveur répond-il aux joueurs ?
 *
 * Wings sait si un **conteneur** tourne, et c'est tout ce qu'il sait. Un
 * conteneur en marche dont le monde ne charge pas, dont le port n'est pas
 * publié, ou qui s'est figé sur une corruption de chunk, reste « running »
 * pour le daemon alors qu'aucun joueur ne peut entrer. Le relevé de
 * consommation ne le verra pas davantage : le processus consomme, justement.
 *
 * La seule façon honnête de savoir si un serveur de jeu répond est de lui
 * parler **comme un joueur le ferait** — d'où cette sonde, qui ouvre une
 * connexion sur le port public et exécute la poignée de main du protocole.
 *
 * Deux règles la gouvernent :
 *
 * 1. **Elle ne sonde que ce qui est censé tourner.** Un serveur à l'arrêt ne
 *    répond pas, et l'écrire à la minute remplirait la table de « injoignable »
 *    parfaitement attendus, au milieu desquels une vraie panne serait invisible.
 * 2. **Elle n'écrit que dans `server_health`.** Le nombre de joueurs pourrait
 *    aussi aller dans `server_metrics.players`, mais cette table a déjà son
 *    auteur — le relevé de consommation — et deux plumes sur une même colonne
 *    finissent toujours par écrire l'une sur l'autre.
 */

/**
 * Cadence de la sonde.
 *
 * La même minute que le relevé de consommation, et pour la même raison : c'est
 * la granularité en deçà de laquelle on mesure le bruit plutôt que l'état. Elle
 * suit aussi le relevé de près, puisqu'elle s'appuie sur lui pour savoir quels
 * serveurs tournent.
 */
const TICK_MS = 60_000;

/**
 * Ce qu'on accorde à un serveur pour dire bonjour.
 *
 * Trois secondes : la poignée de main d'état est une lecture de fichier en
 * mémoire, elle ne calcule rien. Un serveur qui met plus longtemps est un
 * serveur saturé — précisément ce que cette sonde doit rapporter, et non
 * attendre.
 */
const TIMEOUT_MS = 3_000;

/**
 * Fenêtre des sondes retenues pour décider d'une panne : les trois dernières
 * minutes et une marge pour un tour en retard.
 */
const RECENT_WINDOW_MS = 5 * 60_000;

/** Sondes menées de front. Une connexion TCP coûte peu, mais pas rien. */
const CONCURRENCY = 16;

/**
 * Fraîcheur exigée du relevé qui dit « ce serveur tourne ».
 *
 * Trois minutes, soit trois tours : assez pour qu'un relevé manqué n'éteigne
 * pas la sonde, assez court pour qu'un serveur arrêté cesse vite d'être
 * interrogé.
 */
const RUNNING_WINDOW = "3 minutes";

interface ProbeTarget {
  id: string;
  name: string;
  host: string;
  port: number;
}

@Injectable()
export class GameProbeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameProbeService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => battre(this.logger, "game-probe", () => this.tick()), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Un tour : sonder les serveurs de jeu qui sont censés répondre. */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const targets = await this.targets();
      // Même sans cible : un serveur tombé puis arrêté doit être levé.
      await this.forgetStopped(targets.map((target) => target.id));
      if (targets.length === 0) return;

      let silent = 0;
      for (let start = 0; start < targets.length; start += CONCURRENCY) {
        const batch = targets.slice(start, start + CONCURRENCY);
        const results = await Promise.all(batch.map((target) => this.probe(target, now)));
        silent += results.filter((status) => status === null).length;
      }

      await this.alert(targets, now);

      if (silent > 0) {
        this.logger.warn(
          `Sonde de jeu : ${targets.length - silent} serveur(s) ont répondu, ${silent} non.`,
        );
      }
    } catch (error) {
      // Un tour raté ne tue pas le minuteur : le suivant réessaiera.
      this.logger.error(`Tour de sonde interrompu : ${describe(error)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Prévient quand un serveur tombe ou revient.
   *
   * La décision vient des dernières sondes de chaque cible, pas du seul tour
   * en cours (`reachabilityTransition`) : une sonde manquée ne suffit pas.
   * `servers.unreachable_since` porte l'état entre deux tours, et seule sa
   * **transition** notifie : une panne de trois heures fait un message à
   * l'entrée et un à la sortie, pas cent quatre-vingts.
   */
  private async alert(targets: ProbeTarget[], now: Date): Promise<void> {
    const ids = targets.map((target) => target.id);
    const known = await this.db
      .select({ id: servers.id, since: servers.unreachableSince })
      .from(servers)
      .where(inArray(servers.id, ids));
    const since = new Map(known.map((row) => [row.id, row.since]));

    for (const target of targets) {
      const recent = await this.db
        .select({ reachable: serverHealth.reachable })
        .from(serverHealth)
        .where(
          and(
            eq(serverHealth.serverId, target.id),
            // Les sondes de ce passage seulement : des échecs d'hier, avant un
            // arrêt, ne doivent pas compter pour la panne d'aujourd'hui.
            gte(serverHealth.at, new Date(now.getTime() - RECENT_WINDOW_MS).toISOString()),
          ),
        )
        .orderBy(desc(serverHealth.at))
        .limit(MISSES_BEFORE_ALERT);

      const down = since.get(target.id) ?? null;
      const transition = reachabilityTransition(
        recent.map((row) => row.reachable),
        down !== null,
      );

      if (transition === "down") {
        await this.db
          .update(servers)
          .set({ unreachableSince: now.toISOString() })
          .where(eq(servers.id, target.id));
        await this.notifications.notifyServerOwner(target.id, {
          type: "server.unreachable",
          title: `${target.name} ne répond plus`,
          body: `Le serveur tourne mais ne répond plus aux joueurs sur ${target.host}:${target.port} depuis ${MISSES_BEFORE_ALERT} minutes. Consultez sa console.`,
          level: "danger",
        });
      } else if (transition === "up" && down !== null) {
        await this.db
          .update(servers)
          .set({ unreachableSince: null })
          .where(eq(servers.id, target.id));
        await this.notifications.notifyServerOwner(target.id, {
          type: "server.recovered",
          title: `${target.name} répond de nouveau`,
          body: `Le serveur est de nouveau joignable, après ${outageDuration(new Date(down), now)} d'interruption.`,
          level: "success",
        });
      }
    }
  }

  /**
   * Lève sans bruit la panne d'un serveur qui n'est plus censé tourner.
   *
   * Arrêté par son propriétaire, il ne répond pas, et c'est normal : garder la
   * marque ferait annoncer un « retour » au prochain démarrage, pour une panne
   * que personne n'a subie depuis l'arrêt.
   */
  private async forgetStopped(running: string[]): Promise<void> {
    await this.db
      .update(servers)
      .set({ unreachableSince: null })
      .where(
        running.length === 0
          ? isNotNull(servers.unreachableSince)
          : and(isNotNull(servers.unreachableSince), notInArray(servers.id, running)),
      );
  }

  /**
   * Les serveurs à sonder.
   *
   * Le jeu est déduit de l'egg, comme partout ailleurs dans le panel : les eggs
   * de Pterodactyl ne déclarent pas le leur, et inventer une colonne ici en
   * ferait une seconde vérité à tenir à jour. Ce qui n'est pas reconnu comme
   * Minecraft n'est pas sondé — parler le protocole de Minecraft à un serveur
   * de Rust ne dirait rien de sa santé.
   *
   * L'adresse sondée est celle que les joueurs emploient, alias compris. C'est
   * le seul sens utile de « joignable » : un serveur qui répond sur la boucle
   * locale du node mais pas sur son adresse publique est injoignable pour ceux
   * qui comptent.
   */
  private async targets(): Promise<ProbeTarget[]> {
    const rows = await this.db
      .select({
        id: servers.id,
        name: servers.name,
        eggName: eggs.name,
        nestName: nests.name,
        ip: allocations.ip,
        ipAlias: allocations.ipAlias,
        port: allocations.port,
        fqdn: nodes.fqdn,
      })
      .from(servers)
      .innerJoin(eggs, eq(servers.eggId, eggs.id))
      .innerJoin(nests, eq(eggs.nestId, nests.id))
      .innerJoin(nodes, eq(servers.nodeId, nodes.id))
      .innerJoin(allocations, eq(servers.allocationId, allocations.id))
      .where(
        and(
          eq(nodes.maintenanceMode, false),
          /*
           * Sonder ce qui tourne, et le savoir du relevé de consommation.
           *
           * Le panel ne connaît pas l'état du conteneur — il ne le duplique
           * pas, délibérément. Le relevé, lui, l'inscrit dans chaque mesure :
           * s'appuyer dessus évite un second aller-retour vers Wings à la
           * minute, et lie naturellement la sonde à ce que le daemon a dit en
           * dernier.
           */
          sql`exists (
            select 1 from server_metrics m
            where m.server_id = ${servers.id}
              and m.state = 'running'
              and m.at > now() - ${RUNNING_WINDOW}::interval
          )`,
        ),
      );

    return rows.flatMap((row) =>
      detectRuntime(row.eggName, row.nestName, {})?.game === "minecraft"
        ? [{ id: row.id, name: row.name, host: probeHost(row), port: row.port }]
        : [],
    );
  }

  /**
   * Une sonde, et la ligne qu'elle laisse.
   *
   * Contrairement à la sonde des nodes, l'échec **s'écrit** : c'est ici
   * l'information même. Un serveur que le daemon dit en marche et qui ne
   * répond pas à ses joueurs est exactement ce qu'on cherche à rendre visible,
   * et le passer sous silence reviendrait à ne rien sonder du tout.
   */
  private async probe(target: ProbeTarget, now: Date): Promise<MinecraftStatus | null> {
    const status = await ping(target.host, target.port).catch(() => null);

    await this.db.insert(serverHealth).values({
      serverId: target.id,
      at: now.toISOString(),
      reachable: status !== null,
      // Rien plutôt qu'un objet vide : une sonde qui n'a pas abouti n'a rien
      // appris, et un `{}` en base se lit comme un serveur sans joueurs.
      queryPayload: status ?? null,
    });

    return status;
  }
}

/**
 * L'adresse à laquelle on frappe.
 *
 * Celle des joueurs, alias compris : c'est le seul sens utile de « joignable ».
 * Un serveur qui répond sur la boucle locale du node mais pas sur son adresse
 * publique est injoignable pour ceux qui comptent.
 *
 * `0.0.0.0` est une consigne d'écoute, pas une adresse : un egg qui fait
 * écouter le conteneur sur toutes les interfaces range cette valeur dans
 * l'allocation, et s'y connecter viserait la machine du panel elle-même. Le
 * nom du node reste alors la seule adresse qui ait un sens.
 */
export function probeHost(row: { ip: string; ipAlias: string | null; fqdn: string }): string {
  const bindAll = row.ip === "0.0.0.0" || row.ip === "::";
  return row.ipAlias ?? (bindAll ? row.fqdn : row.ip);
}

/**
 * La poignée de main d'état, en clair.
 *
 * Le protocole tient en deux temps : on envoie la poignée de main suivie de la
 * demande d'état, le serveur répond par un JSON. La réponse arrive rarement en
 * un seul paquet, d'où l'accumulation : conclure au premier morceau donnerait
 * « injoignable » pour un serveur qui répondait très bien.
 *
 * Rend `null` dès que quelque chose cloche — délai, port fermé, interlocuteur
 * qui n'est pas un serveur Minecraft. Aucun de ces cas n'est distingué, parce
 * qu'aucun ne change ce qu'il faut en dire : les joueurs n'entrent pas.
 */
export function ping(host: string, port: number): Promise<MinecraftStatus | null> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let chunks = Buffer.alloc(0);
    let settled = false;

    const finish = (status: MinecraftStatus | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(status);
    };

    socket.setTimeout(TIMEOUT_MS);
    socket.on("timeout", () => finish(null));
    socket.on("error", () => finish(null));
    // Fin de flux sans réponse exploitable : le serveur a raccroché.
    socket.on("close", () => finish(null));

    socket.on("data", (chunk) => {
      chunks = Buffer.concat([chunks, chunk]);
      const status = readStatusResponse(chunks);
      // `null` signifie « trame encore incomplète » : on attend la suite
      // jusqu'au délai, plutôt que de conclure sur un début de JSON.
      if (status) finish(status);
    });

    socket.connect(port, host, () => {
      socket.write(buildStatusRequest(host, port));
    });
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
