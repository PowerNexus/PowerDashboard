import { isIP } from "node:net";
import { consoleCommandTrace } from "@gamedashboard/contracts";
import { activityLogs, type Database, serverSubusers, servers, users } from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, exists, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DATABASE } from "../../common/database.provider";

/** Une entrée telle que Wings l'envoie (`internal/models.Activity`). */
export interface WingsActivity {
  /** UUID de l'utilisateur, ou `null` quand l'événement ne vient de personne. */
  user?: string | null;
  server?: string;
  event?: string;
  metadata?: unknown;
  ip?: string;
  timestamp?: string;
}

/** Un lot plus gros que cela vient d'un daemon qui a accumulé, ou d'un abus. */
const MAX_BATCH = 200;

/**
 * Bornes de l'horodatage déclaré par le daemon.
 *
 * Dans le futur, l'avance d'une horloge mal réglée, pas davantage : une ligne
 * datée de l'an 2999 resterait en tête du journal pour toujours. Dans le
 * passé, un mois : Wings garde ses lignes tant que le panel ne les a pas
 * reçues, et une coupure de quelques jours doit laisser les vraies dates —
 * au-delà, ce n'est plus un retard, c'est une date inventée, qui enfouirait
 * l'événement là où personne ne le cherchera.
 */
const MAX_CLOCK_AHEAD_MS = 5 * 60_000;
const MAX_BACKLOG_MS = 30 * 24 * 3600_000;

/** Le revendeur d'un serveur, relu pour savoir si la plateforme y a accès. */
const revendeur = alias(users, "revendeur");

/**
 * Journal remonté par le daemon.
 *
 * Ces événements décrivent ce qui s'est passé **hors du panel** : écritures
 * SFTP, surtout. Sans eux, le journal donnerait l'illusion que tout passe par
 * l'interface, et une modification faite en SFTP n'y laisserait aucune trace.
 */
@Injectable()
export class RemoteActivityService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Enregistre un lot.
   *
   * Deux vérifications, et les deux comptent parce que le daemon est authentifié
   * mais pas *de confiance* pour autant (§5.5) :
   *
   * 1. le serveur doit appartenir à ce node — sinon un node compromis
   *    écrirait dans le journal des serveurs des autres ;
   * 2. l'auteur déclaré doit avoir **accès à ce serveur** — sinon il
   *    attribuerait une suppression de fichiers à n'importe quel compte de la
   *    plateforme. Exister ne suffisait pas : c'était toute la liste des
   *    comptes qu'un node pouvait accuser.
   *
   * Une entrée qui échoue est **écartée en silence**, et le lot continue. Un
   * refus ferait réessayer Wings indéfiniment le même lot, et une seule ligne
   * douteuse bloquerait tout le journal du node. Un auteur sans lien, lui,
   * n'écarte pas l'entrée : l'écriture a bien eu lieu, seule l'attribution est
   * refusée.
   */
  async record(nodeId: string, entries: WingsActivity[]): Promise<void> {
    const batch = entries.slice(0, MAX_BATCH);
    if (batch.length === 0) return;

    const serverIds = [...new Set(batch.map((e) => e.server).filter(isUuid))];
    if (serverIds.length === 0) return;

    const owned = await this.db
      .select({ id: servers.id })
      .from(servers)
      .where(and(eq(servers.nodeId, nodeId), inArray(servers.id, serverIds)));
    const allowedServers = new Set(owned.map((row) => row.id));
    if (allowedServers.size === 0) return;

    const userIds = [...new Set(batch.map((e) => e.user).filter(isUuid))];
    const links = userIds.length === 0 ? [] : await this.linked([...allowedServers], userIds);
    const labels = new Map(
      links.map((l) => [`${l.serverId}|${l.userId}`, `${l.first} ${l.last}`.trim()]),
    );

    const rows = batch
      .filter((entry) => entry.server && allowedServers.has(entry.server) && entry.event)
      .map((entry) => {
        const label = isUuid(entry.user) ? labels.get(`${entry.server}|${entry.user}`) : undefined;
        const actorId = label !== undefined ? (entry.user as string) : null;
        return {
          actorId,
          // Faute d'auteur identifiable, l'événement est attribué au système :
          // c'est exact, et cela vaut mieux que de le rattacher au hasard à
          // quelqu'un — un journal qui accuse à tort ne vaut rien.
          actorType: (actorId ? "user" : "system") as "user" | "system",
          actorLabel: label ?? "Daemon",
          serverId: entry.server as string,
          event: String(entry.event).slice(0, 120),
          ip: toIp(entry.ip),
          properties: toProperties(entry.event, entry.metadata),
          // L'horodatage vient du daemon : c'est lui qui sait quand l'action a
          // eu lieu, et un lot peut arriver avec du retard après une coupure
          // réseau. Une valeur inexploitable, ou hors des bornes, retombe sur
          // l'instant présent plutôt que de faire échouer le lot.
          at: parseTimestamp(entry.timestamp),
        };
      });

    if (rows.length === 0) return;
    await this.db.insert(activityLogs).values(rows);
  }

  /**
   * Les couples (serveur, compte) où le compte a accès au serveur.
   *
   * La portée est celle de `ServerAccessService`, et non « propriétaire ou
   * sous-utilisateur » seulement : le personnel et le revendeur ouvrent aussi
   * la console d'un serveur client, et Wings journalise alors leurs
   * commandes sous leur identité — c'est précisément la trace qu'on cherche
   * après coup. Les restreindre les ferait passer pour « Daemon ».
   *
   * - propriétaire ;
   * - sous-utilisateur **ayant accepté** : une invitation en attente ne
   *   donne aucun accès, donc aucune action à attribuer ;
   * - revendeur du serveur ;
   * - administrateur ou support, sauf sur le parc d'un revendeur qui a fermé
   *   l'accès à la plateforme (`platform_access = 'none'`,
   *   `ServerAccessService.staffAccess`).
   *
   * Une seule requête pour tout le lot : deux cents lignes ne valent pas deux
   * cents allers-retours.
   */
  private linked(
    serverIds: string[],
    userIds: string[],
  ): Promise<{ serverId: string; userId: string; first: string; last: string }[]> {
    return this.db
      .select({
        serverId: servers.id,
        userId: users.id,
        first: users.nameFirst,
        last: users.nameLast,
      })
      .from(servers)
      .innerJoin(users, inArray(users.id, userIds))
      .leftJoin(revendeur, eq(revendeur.id, servers.resellerId))
      .where(
        and(
          inArray(servers.id, serverIds),
          or(
            eq(servers.ownerId, users.id),
            eq(servers.resellerId, users.id),
            exists(
              this.db
                .select({ id: serverSubusers.id })
                .from(serverSubusers)
                .where(
                  and(
                    eq(serverSubusers.serverId, servers.id),
                    eq(serverSubusers.userId, users.id),
                    isNotNull(serverSubusers.acceptedAt),
                  ),
                ),
            ),
            and(
              inArray(users.role, ["admin", "support"]),
              sql`${revendeur.platformAccess} is distinct from 'none'`,
            ),
          ),
        ),
      );
  }
}

/**
 * Adresse de l'auteur, ou `null` quand ce n'en est pas une.
 *
 * La colonne `inet` refuse une valeur invalide, et **tout le lot** avec elle :
 * une 500, que Wings rejoue en boucle. `isIP` écarte le texte libre et
 * l'adresse suivie d'un port ; l'indice de zone IPv6 (`fe80::1%eth0`), qu'il
 * accepte, est écarté à part — PostgreSQL le refuse.
 */
function toIp(value: unknown): string | null {
  if (typeof value !== "string" || value.includes("%")) return null;
  return isIP(value) === 0 ? null : value;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/** Wings envoie `null`, une chaîne, ou un objet. Le stockage attend un objet. */
/** Nom que Wings donne à une commande envoyée par la socket de console. */
const CONSOLE_COMMAND_EVENT = "server:console.command";

/** Taille maximale des propriétés d'une entrée, une fois sérialisées. */
const MAX_PROPERTIES_BYTES = 8 * 1024;

function toProperties(event: unknown, metadata: unknown): Record<string, unknown> {
  if (metadata === null || metadata === undefined) return {};
  const properties =
    typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : { value: metadata };

  /*
   * Une commande tapée sur la socket, que Wings rapporte en clair : même
   * règle que pour celles qui passent par le panel — premier mot et longueur
   * du reste, jamais les arguments, où passent les mots de passe.
   */
  if (event === CONSOLE_COMMAND_EVENT && typeof properties.command === "string") {
    return { ...properties, ...consoleCommandTrace(properties.command) };
  }

  // Bornées : une valeur démesurée ferait échouer l'insertion du lot entier,
  // et le daemon le renverrait indéfiniment.
  let size: number;
  try {
    size = JSON.stringify(properties).length;
  } catch {
    return { truncated: true };
  }
  return size > MAX_PROPERTIES_BYTES ? { truncated: true, size } : properties;
}

function parseTimestamp(value: string | undefined): string {
  const now = Date.now();
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  const plausible =
    !Number.isNaN(parsed) && parsed <= now + MAX_CLOCK_AHEAD_MS && parsed >= now - MAX_BACKLOG_MS;
  return new Date(plausible ? parsed : now).toISOString();
}
