import { activityLogs, type Database, servers, users } from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
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
   * 2. l'auteur déclaré doit exister — sinon il pourrait attribuer une
   *    suppression de fichiers à n'importe quel identifiant.
   *
   * Une entrée qui échoue est **écartée en silence**, et le lot continue. Un
   * refus ferait réessayer Wings indéfiniment le même lot, et une seule ligne
   * douteuse bloquerait tout le journal du node.
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

    const userIds = [...new Set(batch.map((e) => e.user).filter(isUuid))];
    const known =
      userIds.length === 0
        ? []
        : await this.db
            .select({ id: users.id, first: users.nameFirst, last: users.nameLast })
            .from(users)
            .where(inArray(users.id, userIds));
    const labels = new Map(known.map((u) => [u.id, `${u.first} ${u.last}`.trim()]));

    const rows = batch
      .filter((entry) => entry.server && allowedServers.has(entry.server) && entry.event)
      .map((entry) => {
        const actorId = isUuid(entry.user) && labels.has(entry.user) ? entry.user : null;
        return {
          actorId,
          // Faute d'auteur identifiable, l'événement est attribué au système :
          // c'est exact, et cela vaut mieux que de le rattacher au hasard à
          // quelqu'un — un journal qui accuse à tort ne vaut rien.
          actorType: (actorId ? "user" : "system") as "user" | "system",
          actorLabel: actorId ? (labels.get(actorId) ?? "Compte inconnu") : "Daemon",
          serverId: entry.server as string,
          event: String(entry.event).slice(0, 120),
          // Une adresse est au plus 45 caractères : au-delà, ce n'en est pas
          // une, et la colonne `inet` la refuserait avec tout le lot.
          ip: entry.ip && entry.ip !== "" && entry.ip.length <= 45 ? entry.ip : null,
          properties: toProperties(entry.metadata),
          // L'horodatage vient du daemon : c'est lui qui sait quand l'action a
          // eu lieu, et un lot peut arriver avec du retard après une coupure
          // réseau. Une valeur inexploitable retombe sur l'instant présent
          // plutôt que de faire échouer le lot.
          at: parseTimestamp(entry.timestamp),
        };
      });

    if (rows.length === 0) return;
    await this.db.insert(activityLogs).values(rows);
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/** Wings envoie `null`, une chaîne, ou un objet. Le stockage attend un objet. */
/** Taille maximale des propriétés d'une entrée, une fois sérialisées. */
const MAX_PROPERTIES_BYTES = 8 * 1024;

function toProperties(metadata: unknown): Record<string, unknown> {
  if (metadata === null || metadata === undefined) return {};
  const properties =
    typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : { value: metadata };

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
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
