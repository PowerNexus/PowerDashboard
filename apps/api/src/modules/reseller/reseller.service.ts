import { type PlatformAccess, platformAccessOf } from "@gamedashboard/contracts";
import {
  allocations,
  type Database,
  eggs,
  locations,
  nodeResellerShares,
  nodes,
  servers,
  users,
} from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import { DATABASE } from "../../common/database.provider";
import { ResellerShareService } from "./reseller-share.service";

/**
 * Le parc d'un revendeur.
 *
 * Deux façons de confier du matériel, et l'hébergeur choisit machine par
 * machine :
 *
 * - **VPS** : `nodes.owner_id` — la machine entière est à ce revendeur ;
 * - **dédié partagé** : `node_reseller_shares` — trois, quatre, cinq
 *   revendeurs sur la même machine, chacun sa part de capacité.
 *
 * Le rattachement d'un **serveur** ne se déduit plus de la machine. « Les
 * serveurs d'un revendeur sont ceux qui tournent sur ses machines » était vrai
 * tant qu'une machine n'avait qu'un titulaire ; dès qu'elle en porte plusieurs,
 * le node ne dit plus à qui revient chaque serveur. C'est
 * `servers.reseller_id` qui tranche, posé au provisionnement.
 *
 * Il n'existe toujours **aucune table** reliant un revendeur à ses clients : un
 * client est le propriétaire d'un serveur provisionné sous ce revendeur. Une
 * seconde relation pourrait contredire la première, et il faudrait alors
 * décider laquelle a raison.
 *
 * Enfin, un revendeur ne voit **jamais** la charge totale d'une machine
 * partagée — seulement la sienne. La charge globale révélerait l'activité des
 * autres revendeurs qui s'y trouvent, c'est-à-dire celle de concurrents.
 */

export interface ResellerNode {
  id: string;
  name: string;
  fqdn: string;
  location: string;
  maintenance: boolean;
  /**
   * Capacité **du revendeur** sur cette machine, pas celle de la machine.
   *
   * Une machine confiée en entier : la capacité de la machine. Une machine
   * découpée : la part du revendeur. La distinction est le sujet même du mode
   * partagé — annoncer 128 Go à quelqu'un qui en détient 32 l'inviterait à en
   * vendre quatre fois trop.
   */
  memoryMb: number;
  diskMb: number;
  /** Nul sur une machine partagée : les cœurs ne se découpent pas ici. */
  cpuCores: number | null;
  /**
   * Ce que **ce revendeur** consomme sur cette machine, jamais la charge totale.
   *
   * Sur un dédié partagé, la charge de la machine révélerait l'activité des
   * autres revendeurs qui s'y trouvent — c'est-à-dire celle de concurrents.
   */
  usedMemoryMb: number;
  usedDiskMb: number;
  servers: number;
  freePorts: number;
  totalPorts: number;
  lastHeartbeatAt: string | null;
  /** Comment la machine lui est confiée. */
  tenancy: "dedicated" | "shared";
  /**
   * Comment la consommation a été obtenue : relevée, ou majorée par les
   * limites faute de mesure. L'écran doit pouvoir le dire.
   */
  usageBasis: "measured" | "estimated" | "partial";
}

export interface ResellerServer {
  id: string;
  shortId: string;
  name: string;
  owner: string;
  ownerEmail: string;
  node: string;
  egg: string;
  state: string | null;
  memoryMb: number;
  diskMb: number;
  cpuPct: number;
  swapMb: number;
  backupLimit: number;
  databaseLimit: number;
  allocationLimit: number;
  createdAt: string;
}

export interface ResellerClient {
  id: string;
  name: string;
  email: string;
  servers: number;
  memoryMb: number;
}

@Injectable()
export class ResellerService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ResellerShareService) private readonly shares: ResellerShareService,
  ) {}

  /**
   * Machines du revendeur, avec ce qui y est réellement alloué.
   *
   * L'état n'est pas calculé ici : il se déduit de l'âge du heartbeat par
   * `nodeStatus()`, partagé avec l'interface. Le figer côté serveur donnerait
   * une conclusion datée du moment de la requête, alors qu'un node devient
   * périmé pendant qu'on regarde la page.
   */
  async nodes(ownerId: string): Promise<ResellerNode[]> {
    /*
     * Deux façons d'être sur une machine, et la requête les réunit.
     *
     * `nodes.owner_id` : la machine entière lui est confiée. Une part dans
     * `node_reseller_shares` : il en détient une tranche, aux côtés d'autres
     * revendeurs. Une jointure externe sur les parts, plus un `or` sur la
     * propriété, couvre les deux sans compter deux fois — une machine ne peut
     * pas être à la fois entièrement confiée et découpée.
     */
    const rows = await this.db
      .select({
        id: nodes.id,
        name: nodes.name,
        fqdn: nodes.fqdn,
        location: locations.short,
        maintenance: nodes.maintenanceMode,
        nodeMemoryMb: nodes.memoryMb,
        nodeDiskMb: nodes.diskMb,
        nodeCpuCores: nodes.cpuCores,
        lastHeartbeatAt: nodes.lastHeartbeatAt,
        ownerId: nodes.ownerId,
        shareMemoryMb: nodeResellerShares.memoryMb,
        shareDiskMb: nodeResellerShares.diskMb,
      })
      .from(nodes)
      .innerJoin(locations, eq(nodes.locationId, locations.id))
      .leftJoin(
        nodeResellerShares,
        and(eq(nodeResellerShares.nodeId, nodes.id), eq(nodeResellerShares.resellerId, ownerId)),
      )
      .where(or(eq(nodes.ownerId, ownerId), eq(nodeResellerShares.resellerId, ownerId)))
      .orderBy(nodes.name);

    return Promise.all(
      rows.map(async (row) => {
        const dedicated = row.ownerId === ownerId;

        /*
         * La consommation est celle de **ses** serveurs, relevée par le daemon.
         *
         * Le calcul vit dans `ResellerShareService` et non ici : c'est le même
         * que celui qui décidera d'une coupure, et deux implémentations
         * finiraient par ne plus dire la même chose au moment où cela compte.
         */
        const usage = await this.shares.usageOnNode(row.id, ownerId);

        const [free] = await this.db
          .select({ n: count() })
          .from(allocations)
          .where(and(eq(allocations.nodeId, row.id), isNull(allocations.serverId)));
        const [total] = await this.db
          .select({ n: count() })
          .from(allocations)
          .where(eq(allocations.nodeId, row.id));

        return {
          id: row.id,
          name: row.name,
          fqdn: row.fqdn,
          location: row.location,
          maintenance: row.maintenance,
          memoryMb: dedicated ? row.nodeMemoryMb : (row.shareMemoryMb ?? 0),
          diskMb: dedicated ? row.nodeDiskMb : (row.shareDiskMb ?? 0),
          // Les cœurs ne se découpent pas : sur une part, l'annoncer serait
          // promettre une exclusivité que le partage ne donne pas.
          cpuCores: dedicated ? row.nodeCpuCores : null,
          usedMemoryMb: usage.memoryMb,
          usedDiskMb: usage.diskMb,
          servers: usage.servers,
          freePorts: free?.n ?? 0,
          totalPorts: total?.n ?? 0,
          lastHeartbeatAt: row.lastHeartbeatAt,
          tenancy: dedicated ? ("dedicated" as const) : ("shared" as const),
          usageBasis: usage.basis,
        };
      }),
    );
  }

  /** Serveurs hébergés sur les machines du revendeur, le plus récent en tête. */
  async servers(ownerId: string): Promise<ResellerServer[]> {
    return (
      this.db
        .select({
          id: servers.id,
          shortId: servers.uuidShort,
          name: servers.name,
          owner: sql<string>`${users.nameFirst} || ' ' || ${users.nameLast}`,
          ownerEmail: users.email,
          node: nodes.name,
          egg: eggs.name,
          state: servers.state,
          /*
           * Les sept quantites de l'offre, et non les deux qu'on affiche.
           *
           * L'ecran du parc n'en montrait que deux, et son dialogue de
           * changement d'offre ne pouvait donc proposer que celles-la : un
           * revendeur devait passer par l'API ou par l'administration pour
           * toucher au processeur ou aux plafonds. Les rendre ici coute une
           * colonne de plus dans une requete deja faite.
           */
          memoryMb: servers.memoryMb,
          diskMb: servers.diskMb,
          cpuPct: servers.cpuPct,
          swapMb: servers.swapMb,
          backupLimit: servers.backupLimit,
          databaseLimit: servers.databaseLimit,
          allocationLimit: servers.allocationLimit,
          createdAt: servers.createdAt,
        })
        .from(servers)
        .innerJoin(nodes, eq(servers.nodeId, nodes.id))
        .innerJoin(users, eq(servers.ownerId, users.id))
        .innerJoin(eggs, eq(servers.eggId, eggs.id))
        // Le rattachement vient du serveur, plus de la machine : sur un dédié
        // partagé, le node ne dit plus à quel revendeur revient chaque serveur.
        .where(eq(servers.resellerId, ownerId))
        .orderBy(desc(servers.createdAt))
    );
  }

  /**
   * Clients du revendeur : les propriétaires des serveurs de ses machines.
   *
   * Le revendeur lui-même en fait partie quand il héberge ses propres serveurs,
   * et c'est exact — l'écarter ferait que la somme des mémoires par client ne
   * correspondrait plus à celle du parc, sans que rien ne l'explique.
   */
  async clients(ownerId: string): Promise<ResellerClient[]> {
    return (
      this.db
        .select({
          id: users.id,
          name: sql<string>`${users.nameFirst} || ' ' || ${users.nameLast}`,
          email: users.email,
          servers: sql<number>`count(${servers.id})::int`,
          memoryMb: sql<number>`coalesce(sum(${servers.memoryMb}), 0)::int`,
        })
        .from(servers)
        .innerJoin(users, eq(servers.ownerId, users.id))
        // Le rattachement vient du serveur : sur un dédié partagé, filtrer par la
        // machine montrerait au revendeur les clients de ses voisins.
        .where(eq(servers.resellerId, ownerId))
        .groupBy(users.id, users.nameFirst, users.nameLast, users.email)
        .orderBy(desc(sql`count(${servers.id})`))
    );
  }

  /** Ce que ce revendeur laisse la plateforme faire sur son parc. */
  async platformAccess(userId: string): Promise<PlatformAccess> {
    const [row] = await this.db
      .select({ niveau: users.platformAccess })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // Un compte introuvable ne rend pas `provision` : l'absence de réponse
    // n'est pas une autorisation.
    return platformAccessOf(row?.niveau);
  }

  /**
   * Pose le niveau.
   *
   * Seul le revendeur l'appelle, pour lui-même : l'identifiant vient de la
   * session, jamais du corps. Accepter un identifiant ici ferait de cette route
   * le moyen, pour l'administration, de s'accorder elle-même la permission
   * qu'elle est censée demander.
   */
  async setPlatformAccess(userId: string, level: PlatformAccess): Promise<void> {
    await this.db
      .update(users)
      .set({ platformAccess: level, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId));
  }
}
