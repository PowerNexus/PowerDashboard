import { activityLogs, type Database, servers, users } from "@gamedashboard/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

export interface ActivityEntry {
  id: string;
  event: string;
  actorLabel: string;
  actorType: "user" | "api_key" | "system";
  ip: string | null;
  properties: Record<string, unknown>;
  at: string;
}

/**
 * Une ligne du journal, vue depuis l'administration.
 *
 * Elle porte en plus le serveur concerné — nul pour un événement de compte — et
 * l'identifiant de l'acteur, qui permet de filtrer sur une personne sans
 * dépendre de son nom, lequel est figé au moment de l'action.
 */
export interface PlatformActivityEntry extends ActivityEntry {
  actorId: string | null;
  serverId: string | null;
  serverName: string | null;
}

export interface RecordInput {
  event: string;
  serverId: string | null;
  actorId: string | null;
  actorType: "user" | "api_key" | "system";
  actorLabel: string;
  ip?: string | null;
  userAgent?: string | null;
  properties?: Record<string, unknown>;
}

/** Une page de journal. Au-delà, l'écran deviendrait illisible avant d'être utile. */
const PAGE_SIZE = 50;

/**
 * Journal d'audit, en ajout seul.
 *
 * Aucune méthode de modification ni de suppression n'existe, et c'est
 * volontaire : un journal qu'on peut retoucher ne prouve rien. Les lignes
 * disparaissent par la rétention, jamais par une action.
 */
@Injectable()
export class ActivityService {
  /** Publique pour qu'un test puisse la museler sans contourner le type. */
  readonly logger = new Logger(ActivityService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Consigne un événement.
   *
   * **N'échoue jamais.** Une écriture de journal ratée ne doit pas annuler
   * l'action qu'elle décrit : refuser un redémarrage parce que le journal est
   * plein transformerait un problème d'audit en panne de service. L'échec part
   * dans les journaux du processus, où il sera vu.
   *
   * La conséquence est assumée : le journal peut avoir des trous. C'est le bon
   * compromis pour un panel d'hébergement, ce ne le serait pas pour un registre
   * comptable.
   */
  async record(input: RecordInput): Promise<void> {
    try {
      await this.db.insert(activityLogs).values({
        actorId: input.actorId,
        actorType: input.actorType,
        actorLabel: input.actorLabel,
        serverId: input.serverId,
        event: input.event,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        properties: input.properties ?? {},
        at: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.error(
        `Journal : « ${input.event} » non consigné — ${
          error instanceof Error ? error.message : "erreur inconnue"
        }`,
      );
    }
  }

  /**
   * Journal d'un serveur.
   *
   * Le filtrage se fait en base et non après coup : une recherche appliquée en
   * mémoire sur une page déjà tronquée ne trouverait que ce qui figure dans les
   * cinquante dernières lignes, et donnerait « aucun résultat » pour un
   * événement qui existe.
   */
  async forServer(
    serverId: string,
    options: { query?: string; page?: number } = {},
  ): Promise<{ items: ActivityEntry[]; page: number; hasMore: boolean }> {
    const page = Math.max(1, Math.trunc(options.page ?? 1));
    const search = options.query?.trim();

    const conditions = [eq(activityLogs.serverId, serverId)];
    if (search) {
      const pattern = `%${search}%`;
      const ipMatch = or(
        ilike(activityLogs.actorLabel, pattern),
        ilike(activityLogs.event, pattern),
        // `inet` ne se compare pas à un motif texte : la colonne est convertie
        // explicitement, sinon PostgreSQL refuse l'opérateur.
        sql`host(${activityLogs.ip}) ilike ${pattern}`,
      );
      if (ipMatch) conditions.push(ipMatch);
    }

    const rows = await this.db
      .select({
        id: activityLogs.id,
        event: activityLogs.event,
        actorLabel: activityLogs.actorLabel,
        actorType: activityLogs.actorType,
        ip: activityLogs.ip,
        properties: activityLogs.properties,
        at: activityLogs.at,
      })
      .from(activityLogs)
      .where(and(...conditions))
      .orderBy(desc(activityLogs.at))
      // Une ligne de plus que la page : c'est elle qui dit s'il y a une suite,
      // sans payer un COUNT sur une table qui grossit sans fin.
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE);

    const hasMore = rows.length > PAGE_SIZE;
    return {
      page,
      hasMore,
      items: rows.slice(0, PAGE_SIZE).map((row) => ({
        id: row.id,
        event: row.event,
        actorLabel: row.actorLabel,
        actorType: row.actorType as ActivityEntry["actorType"],
        ip: row.ip,
        properties: (row.properties ?? {}) as Record<string, unknown>,
        at: row.at,
      })),
    };
  }

  /**
   * Le journal de toute la plateforme.
   *
   * **Sans cette lecture, une partie du journal n'avait aucun lecteur.** Les
   * événements de compte — mot de passe changé, adresse confirmée, rôle
   * modifié, session révoquée — portent `server_id = null` : ils étaient écrits
   * avec soin et ne figuraient sur aucun écran. Un journal d'audit que personne
   * ne peut consulter n'est pas un journal d'audit.
   *
   * Les filtres portent sur ce qu'on cherche réellement après coup : un
   * événement précis, une personne, un serveur, une période. Le tout en base,
   * jamais en mémoire — filtrer une page déjà tronquée donnerait « aucun
   * résultat » pour un événement qui existe, au-delà des cinquante dernières
   * lignes.
   */
  async forPlatform(
    options: {
      query?: string;
      event?: string;
      actorId?: string;
      serverId?: string;
      since?: string;
      page?: number;
    } = {},
  ): Promise<{ items: PlatformActivityEntry[]; page: number; hasMore: boolean }> {
    const page = Math.max(1, Math.trunc(options.page ?? 1));
    const conditions = [];

    const search = options.query?.trim();
    if (search) {
      const pattern = `%${search}%`;
      const match = or(
        ilike(activityLogs.actorLabel, pattern),
        ilike(activityLogs.event, pattern),
        sql`host(${activityLogs.ip}) ilike ${pattern}`,
      );
      if (match) conditions.push(match);
    }

    /*
     * Le filtre d'événement accepte un préfixe.
     *
     * « account. » rassemble tout ce qui touche aux comptes, « server.power »
     * les seuls démarrages et arrêts. Chercher un événement exact obligerait à
     * connaître la liste par cœur, et une recherche libre ramènerait les
     * lignes où le mot figure ailleurs.
     */
    if (options.event?.trim()) {
      conditions.push(ilike(activityLogs.event, `${options.event.trim()}%`));
    }
    if (options.actorId) conditions.push(eq(activityLogs.actorId, options.actorId));
    if (options.serverId) conditions.push(eq(activityLogs.serverId, options.serverId));
    if (options.since) conditions.push(sql`${activityLogs.at} >= ${options.since}`);

    const rows = await this.db
      .select({
        id: activityLogs.id,
        event: activityLogs.event,
        actorId: activityLogs.actorId,
        actorLabel: activityLogs.actorLabel,
        actorType: activityLogs.actorType,
        ip: activityLogs.ip,
        properties: activityLogs.properties,
        at: activityLogs.at,
        serverId: activityLogs.serverId,
        // Le nom du serveur est joint à la lecture, contrairement à celui de
        // l'acteur qui est figé à l'écriture : un serveur renommé doit
        // s'afficher sous son nom actuel, sinon on ne le retrouve pas dans la
        // liste des serveurs.
        serverName: servers.name,
      })
      .from(activityLogs)
      .leftJoin(servers, eq(activityLogs.serverId, servers.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(activityLogs.at))
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE);

    return {
      page,
      hasMore: rows.length > PAGE_SIZE,
      items: rows.slice(0, PAGE_SIZE).map((row) => ({
        id: row.id,
        event: row.event,
        actorId: row.actorId,
        actorLabel: row.actorLabel,
        actorType: row.actorType as ActivityEntry["actorType"],
        ip: row.ip,
        properties: (row.properties ?? {}) as Record<string, unknown>,
        at: row.at,
        serverId: row.serverId,
        serverName: row.serverName,
      })),
    };
  }

  /**
   * Nom lisible d'un utilisateur, figé au moment de l'action.
   *
   * Recopié dans le journal plutôt que joint à la lecture : un compte supprimé
   * doit rester identifiable, et un compte renommé ne doit pas voir son
   * ancien nom réécrit dans l'historique.
   */
  async labelFor(userId: string): Promise<string> {
    const [row] = await this.db
      .select({ first: users.nameFirst, last: users.nameLast, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) return "Compte inconnu";
    const name = `${row.first} ${row.last}`.trim();
    return name === "" ? row.email : name;
  }
}
