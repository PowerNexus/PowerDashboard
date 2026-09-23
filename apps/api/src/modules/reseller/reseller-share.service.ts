import {
  type Database,
  nodeResellerShares,
  nodes,
  serverMetrics,
  servers,
  users,
} from "@gamedashboard/db";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";

/**
 * Découpage d'une machine entre plusieurs revendeurs.
 *
 * Deux façons de confier du matériel, et l'hébergeur choisit :
 *
 * - **VPS** : la machine entière va à un revendeur (`nodes.owner_id`).
 * - **Dédié partagé** : une machine, trois à cinq revendeurs, chacun sa part.
 *
 * Le plafond d'une part porte sur la **consommation réelle**, pas sur la somme
 * des limites accordées aux serveurs. C'est ce qui rend la revente possible :
 * un revendeur vend plus qu'il ne détient tant que ses clients n'utilisent pas
 * tout. Un plafond sur les limites interdirait précisément ce modèle.
 */

/** Ce qu'une part occupe réellement, avec la façon dont on l'a su. */
export interface ShareUsage {
  memoryMb: number;
  diskMb: number;
  servers: number;
  /**
   * Comment la consommation a été obtenue.
   *
   * `measured` : relevée sur les serveurs, par le daemon.
   * `estimated` : aucune mesure disponible — on retombe sur les limites
   *   accordées, qui majorent la consommation réelle. Jamais l'inverse : sous-
   *   estimer laisserait dépasser un plafond sans que rien ne le voie.
   * `partial` : une partie mesurée, le reste estimé.
   */
  basis: "measured" | "estimated" | "partial";
  /** Serveurs dont la consommation n'a pas pu être relevée. */
  unmeasured: number;
}

export interface NodeShare {
  id: string;
  nodeId: string;
  nodeName: string;
  resellerId: string;
  resellerName: string;
  memoryMb: number;
  diskMb: number;
  serversMax: number | null;
  usage: ShareUsage;
}

/**
 * Au-delà, une mesure est trop vieille pour décider d'une coupure.
 *
 * Cinq minutes : plus long qu'un intervalle de relevé normal, assez court pour
 * qu'on ne coupe jamais un serveur sur une photo d'il y a une heure.
 */
const MEASUREMENT_MAX_AGE_MS = 5 * 60_000;

@Injectable()
export class ResellerShareService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /* --- Lecture ------------------------------------------------------------- */

  /** Les parts posées sur une machine, avec ce que chacune consomme. */
  async sharesOfNode(nodeId: string): Promise<NodeShare[]> {
    const rows = await this.db
      .select({
        id: nodeResellerShares.id,
        nodeId: nodeResellerShares.nodeId,
        nodeName: nodes.name,
        resellerId: nodeResellerShares.resellerId,
        resellerName: sql<string>`${users.nameFirst} || ' ' || ${users.nameLast}`,
        memoryMb: nodeResellerShares.memoryMb,
        diskMb: nodeResellerShares.diskMb,
        serversMax: nodeResellerShares.serversMax,
      })
      .from(nodeResellerShares)
      .innerJoin(nodes, eq(nodeResellerShares.nodeId, nodes.id))
      .innerJoin(users, eq(nodeResellerShares.resellerId, users.id))
      .where(eq(nodeResellerShares.nodeId, nodeId))
      .orderBy(users.nameFirst);

    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        usage: await this.usageOnNode(row.nodeId, row.resellerId),
      })),
    );
  }

  /** Les parts d'un revendeur, toutes machines confondues. */
  async sharesOfReseller(resellerId: string): Promise<NodeShare[]> {
    const rows = await this.db
      .select({
        id: nodeResellerShares.id,
        nodeId: nodeResellerShares.nodeId,
        nodeName: nodes.name,
        resellerId: nodeResellerShares.resellerId,
        resellerName: sql<string>`${users.nameFirst} || ' ' || ${users.nameLast}`,
        memoryMb: nodeResellerShares.memoryMb,
        diskMb: nodeResellerShares.diskMb,
        serversMax: nodeResellerShares.serversMax,
      })
      .from(nodeResellerShares)
      .innerJoin(nodes, eq(nodeResellerShares.nodeId, nodes.id))
      .innerJoin(users, eq(nodeResellerShares.resellerId, users.id))
      .where(eq(nodeResellerShares.resellerId, resellerId))
      .orderBy(nodes.name);

    return Promise.all(
      rows.map(async (row) => ({
        ...row,
        usage: await this.usageOnNode(row.nodeId, row.resellerId),
      })),
    );
  }

  /**
   * Ce qu'un revendeur consomme réellement sur une machine.
   *
   * La mesure vient du dernier relevé de chaque serveur. Quand un serveur n'a
   * aucun relevé — le daemon ne répond pas, ou rien n'a encore été collecté —
   * on retombe sur sa limite accordée et on le **dit** : `basis` distingue une
   * consommation relevée d'une consommation majorée.
   *
   * La distinction n'est pas cosmétique. Couper un serveur parce qu'une
   * estimation dépasse un plafond reviendrait à couper sur une supposition ;
   * c'est précisément ce que `basis` permet de refuser.
   */
  async usageOnNode(nodeId: string, resellerId: string): Promise<ShareUsage> {
    const rows = await this.db
      .select({
        id: servers.id,
        limitMemoryMb: servers.memoryMb,
        limitDiskMb: servers.diskMb,
        /*
         * Dernier relevé de ce serveur, s'il est assez frais.
         *
         * `distinct on` serait plus direct, mais une sous-requête corrélée
         * reste lisible et laisse l'index `(server_id, at)` faire son travail.
         */
        memBytes: sql<number | null>`(
          select m.mem_bytes::float8 from ${serverMetrics} m
          where m.server_id = ${servers.id}
            and m.at > now() - interval '${sql.raw(String(MEASUREMENT_MAX_AGE_MS / 1000))} seconds'
          order by m.at desc limit 1
        )`,
        diskBytes: sql<number | null>`(
          select m.disk_bytes::float8 from ${serverMetrics} m
          where m.server_id = ${servers.id}
            and m.at > now() - interval '${sql.raw(String(MEASUREMENT_MAX_AGE_MS / 1000))} seconds'
          order by m.at desc limit 1
        )`,
      })
      .from(servers)
      .where(and(eq(servers.nodeId, nodeId), eq(servers.resellerId, resellerId)));

    let memoryMb = 0;
    let diskMb = 0;
    let unmeasured = 0;

    for (const row of rows) {
      if (row.memBytes === null || row.diskBytes === null) {
        unmeasured += 1;
        memoryMb += row.limitMemoryMb;
        diskMb += row.limitDiskMb;
        continue;
      }
      memoryMb += Math.round(row.memBytes / (1024 * 1024));
      diskMb += Math.round(row.diskBytes / (1024 * 1024));
    }

    return {
      memoryMb,
      diskMb,
      servers: rows.length,
      basis:
        rows.length === 0 || unmeasured === 0
          ? "measured"
          : unmeasured === rows.length
            ? "estimated"
            : "partial",
      unmeasured,
    };
  }

  /* --- Écriture ------------------------------------------------------------ */

  /**
   * Pose ou met à jour la part d'un revendeur sur une machine.
   *
   * Refusé sur une machine déjà confiée en entier : « toute la machine est à
   * Paul » et « Paul en a 32 Go » se contrediraient, et rien ne dirait laquelle
   * des deux fait foi.
   *
   * La somme des parts **peut** dépasser la capacité de la machine, et c'est
   * voulu : le plafond porte sur la consommation réelle, pas sur les limites.
   * Interdire le surprovisionnement interdirait la revente elle-même.
   */
  async setShare(input: {
    nodeId: string;
    resellerId: string;
    memoryMb: number;
    diskMb: number;
    serversMax: number | null;
  }): Promise<{ id: string }> {
    if (!Number.isInteger(input.memoryMb) || input.memoryMb <= 0) {
      throw new BadRequestException("Mémoire : un entier positif est attendu.");
    }
    if (!Number.isInteger(input.diskMb) || input.diskMb <= 0) {
      throw new BadRequestException("Disque : un entier positif est attendu.");
    }
    if (
      input.serversMax !== null &&
      (!Number.isInteger(input.serversMax) || input.serversMax < 0)
    ) {
      throw new BadRequestException("Nombre de serveurs : un entier positif ou rien.");
    }

    const [node] = await this.db
      .select({ id: nodes.id, ownerId: nodes.ownerId })
      .from(nodes)
      .where(eq(nodes.id, input.nodeId));
    if (!node) throw new NotFoundException("Node introuvable.");

    if (node.ownerId) {
      throw new ConflictException(
        "Cette machine est confiée en entier à un revendeur. Retirez-la-lui d'abord pour la découper.",
      );
    }

    const [reseller] = await this.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, input.resellerId));
    if (!reseller) throw new NotFoundException("Compte introuvable.");
    if (reseller.role !== "reseller") {
      throw new ConflictException(
        "Seul un compte revendeur peut tenir une part : les autres rôles n'ont pas l'espace qui permet de l'exploiter.",
      );
    }

    const [row] = await this.db
      .insert(nodeResellerShares)
      .values({
        nodeId: input.nodeId,
        resellerId: input.resellerId,
        memoryMb: input.memoryMb,
        diskMb: input.diskMb,
        serversMax: input.serversMax,
      })
      .onConflictDoUpdate({
        target: [nodeResellerShares.nodeId, nodeResellerShares.resellerId],
        set: {
          memoryMb: input.memoryMb,
          diskMb: input.diskMb,
          serversMax: input.serversMax,
          updatedAt: new Date().toISOString(),
        },
      })
      .returning({ id: nodeResellerShares.id });

    if (!row) throw new ConflictException("La part n'a pas pu être posée.");
    return { id: row.id };
  }

  /**
   * Retire une part.
   *
   * Refusé tant que le revendeur y fait tourner des serveurs : ils
   * deviendraient des serveurs sur une machine qui ne lui est plus allouée,
   * sans plafond ni écran pour les voir.
   */
  async removeShare(nodeId: string, resellerId: string): Promise<void> {
    const [hosted] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(servers)
      .where(and(eq(servers.nodeId, nodeId), eq(servers.resellerId, resellerId)));

    if ((hosted?.n ?? 0) > 0) {
      throw new ConflictException(
        `Ce revendeur exploite ${hosted?.n} serveur(s) sur cette machine. Transférez-les ou supprimez-les d'abord.`,
      );
    }

    await this.db
      .delete(nodeResellerShares)
      .where(
        and(eq(nodeResellerShares.nodeId, nodeId), eq(nodeResellerShares.resellerId, resellerId)),
      );
  }
}
