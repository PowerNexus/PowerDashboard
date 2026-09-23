import { RUNTIME_STATE_FRESH_WINDOW } from "@gamedashboard/contracts";
import {
  allocations,
  type Database,
  eggs,
  locations,
  nests,
  nodes,
  resellerQuotas,
  servers,
  users,
} from "@gamedashboard/db";
import { Inject, Injectable } from "@nestjs/common";
import { count, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DATABASE } from "../../common/database.provider";

/**
 * Alias de `users` pour la jointure du propriétaire d'un node.
 *
 * Sans alias, la même table apparaîtrait deux fois dans une requête qui joint
 * déjà les comptes ailleurs, et PostgreSQL ne saurait pas laquelle est visée.
 */
const owner = alias(users, "node_owner");

@Injectable()
export class AdminService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Nodes avec leur capacité et leur dernier contact.
   *
   * L'état n'est pas calculé ici : il se déduit de l'âge du heartbeat par
   * `nodeStatus()` de `@gamedashboard/contracts`, partagé avec l'interface. Le
   * calculer côté serveur figerait une conclusion au moment de la requête,
   * alors qu'un node devient périmé pendant qu'on regarde la page.
   */
  async nodes() {
    const rows = await this.db
      .select({
        id: nodes.id,
        name: nodes.name,
        category: nodes.category,
        subcategory: nodes.subcategory,
        location: locations.short,
        fqdn: nodes.fqdn,
        memoryMb: nodes.memoryMb,
        diskMb: nodes.diskMb,
        cpuCores: nodes.cpuCores,
        maintenance: nodes.maintenanceMode,
        wingsVersion: nodes.wingsVersion,
        lastHeartbeatAt: nodes.lastHeartbeatAt,
        // Propriétaire du node. `null` vaut « la plateforme », pas « personne ».
        ownerId: nodes.ownerId,
        ownerName: sql<
          string | null
        >`case when ${nodes.ownerId} is null then null else ${owner.nameFirst} || ' ' || ${owner.nameLast} end`,
        servers: count(servers.id),
        /*
         * Ce qui est **accordé** aux serveurs de la machine.
         *
         * C'est le chiffre qui répond à « puis-je en placer un de plus ? », et
         * il est exact en toutes circonstances : il ne dépend d'aucun relevé,
         * seulement de ce que le panel a lui-même promis. Un node vide affiche
         * donc zéro, et c'est une vérité, pas une absence de mesure.
         */
        allocatedMemoryMb: sql<number>`coalesce(sum(${servers.memoryMb}), 0)::int`,
        allocatedDiskMb: sql<number>`coalesce(sum(${servers.diskMb}), 0)::int`,
        /*
         * Ce qui est **réellement consommé**, quand on a pu le relever.
         *
         * Distinct de l'allocation, et les deux sont utiles : on vend des
         * limites, les clients en consomment une fraction. `null` sur un
         * serveur sans relevé récent ; la somme ne compte alors que ceux qu'on
         * a mesurés, et `measuredServers` dit combien.
         *
         * Wings n'offre aucune route donnant la charge d'une machine : son
         * `/api/system` ne rend que l'architecture, le noyau et la version. La
         * consommation ne peut donc venir que de l'addition des serveurs.
         */
        measuredMemoryMb: sql<
          number | null
        >`(select sum(m.mem_bytes) / 1048576 from (select distinct on (sm.server_id) sm.server_id, sm.mem_bytes from server_metrics sm join ${servers} s2 on s2.id = sm.server_id where s2.node_id = ${nodes.id} and sm.at > now() - interval '5 minutes' order by sm.server_id, sm.at desc) m)::int`,
        measuredDiskMb: sql<
          number | null
        >`(select sum(m.disk_bytes) / 1048576 from (select distinct on (sm.server_id) sm.server_id, sm.disk_bytes from server_metrics sm join ${servers} s2 on s2.id = sm.server_id where s2.node_id = ${nodes.id} and sm.at > now() - interval '5 minutes' order by sm.server_id, sm.at desc) m)::int`,
        measuredServers: sql<number>`(select count(distinct sm.server_id) from server_metrics sm join ${servers} s2 on s2.id = sm.server_id where s2.node_id = ${nodes.id} and sm.at > now() - interval '5 minutes')::int`,
      })
      .from(nodes)
      .innerJoin(locations, eq(nodes.locationId, locations.id))
      // Jointure externe : la grande majorité des nodes appartient à la
      // plateforme et n'a donc aucune ligne en face.
      .leftJoin(owner, eq(nodes.ownerId, owner.id))
      .leftJoin(servers, eq(servers.nodeId, nodes.id))
      .groupBy(nodes.id, locations.short, owner.nameFirst, owner.nameLast)
      .orderBy(nodes.name);

    return rows;
  }

  async servers() {
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
           * L'état réellement observé, et non celui de gestion.
           *
           * `servers.state` porte l'installation, la suspension, le transfert —
           * il est **nul** sur un serveur qui tourne normalement, et c'est
           * volontaire : l'état du conteneur appartient à Wings et n'est pas
           * recopié (§8.2). La liste d'administration n'affichait que cette
           * colonne, et rendait donc « État inconnu » sur des serveurs mesurés
           * à la minute.
           *
           * Le dernier relevé frais comble le trou. En sous-requête plutôt qu'en
           * jointure : `server_metrics` est une histoire, et une jointure
           * ordinaire multiplierait chaque serveur par son nombre de mesures.
           * Au-delà de la fenêtre, `null` — « je ne sais pas » — plutôt qu'un
           * état périmé.
           */
          runtimeState: sql<string | null>`(
          select m.state from server_metrics m
          where m.server_id = ${servers.id}
            and m.at > now() - ${RUNTIME_STATE_FRESH_WINDOW}::interval
          order by m.at desc limit 1
        )`,
          memoryMb: servers.memoryMb,
          createdAt: servers.createdAt,
        })
        .from(servers)
        .innerJoin(users, eq(servers.ownerId, users.id))
        .innerJoin(nodes, eq(servers.nodeId, nodes.id))
        .innerJoin(eggs, eq(servers.eggId, eggs.id))
        /*
         * Les serveurs d'un revendeur qui refuse toute visibilité n'apparaissent
         * pas, **y compris ici**.
         *
         * C'est le sens de « aucune visibilité » : le cacher de la console du
         * client tout en le laissant dans la liste d'administration ferait du
         * réglage une politesse plutôt qu'une règle. Le revendeur qui le choisit
         * sait ce qu'il échange — la plateforme ne pourra plus rien diagnostiquer
         * pour ses clients.
         *
         * Formulé en `not exists` : un serveur sans revendeur n'a rien à prouver
         * et reste visible.
         */
        .where(
          sql`not exists (
          select 1 from ${users} r
          where r.id = ${servers.resellerId} and r.platform_access = 'none'
        )`,
        )
        .orderBy(desc(servers.createdAt))
    );
  }

  async users() {
    return this.db
      .select({
        id: users.id,
        name: sql<string>`${users.nameFirst} || ' ' || ${users.nameLast}`,
        // Les deux moitiés en plus du nom affiché : la fiche de modification
        // les édite séparément, et recouper le nom affiché se tromperait sur
        // « Jean Paul Martin ».
        nameFirst: users.nameFirst,
        nameLast: users.nameLast,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
        locale: users.locale,
        role: users.role,
        // Suspension du compte : `null` pour un compte actif. Le motif ne sort
        // que vers l'administration, jamais vers le titulaire.
        suspendedAt: users.suspendedAt,
        suspensionReason: users.suspensionReason,
        is2faEnabled: users.isTwoFactorEnabled,
        // Ne concerne que les revendeurs ; ailleurs la valeur est ignorée.
        platformAccess: users.platformAccess,
        lastLoginAt: users.lastLoginAt,
        servers: count(servers.id),
        /**
         * Enveloppe du revendeur, `null` partout quand aucune n'est posée.
         *
         * Aplatie en trois colonnes plutôt qu'en objet imbriqué : la jointure
         * est externe, et un objet fabriqué depuis une ligne absente vaudrait
         * `{ memoryMb: null, … }` — soit exactement ce que ces trois colonnes
         * disent déjà, en plus lisible.
         */
        quotaMemoryMb: resellerQuotas.memoryMb,
        quotaDiskMb: resellerQuotas.diskMb,
        quotaServersMax: resellerQuotas.serversMax,
      })
      .from(users)
      .leftJoin(servers, eq(servers.ownerId, users.id))
      .leftJoin(resellerQuotas, eq(resellerQuotas.userId, users.id))
      .groupBy(users.id, resellerQuotas.memoryMb, resellerQuotas.diskMb, resellerQuotas.serversMax)
      .orderBy(users.email);
  }

  async eggs() {
    return this.db
      .select({
        id: eggs.id,
        name: eggs.name,
        nest: nests.name,
        description: eggs.description,
        // La première image de la table : c'est celle proposée par défaut.
        image: sql<string>`coalesce((select value from jsonb_each_text(${eggs.dockerImages}) limit 1), '')`,
        enabled: eggs.enabled,
        updatedAt: eggs.updatedAt,
        servers: count(servers.id),
      })
      .from(eggs)
      .innerJoin(nests, eq(eggs.nestId, nests.id))
      .leftJoin(servers, eq(servers.eggId, eggs.id))
      .groupBy(eggs.id, nests.name)
      .orderBy(nests.name, eggs.name);
  }

  /** Chiffres de tête de l'espace d'administration. */
  async overview() {
    const [totals] = await this.db
      .select({
        servers: sql<number>`(select count(*) from ${servers})::int`,
        users: sql<number>`(select count(*) from ${users})::int`,
        nodes: sql<number>`(select count(*) from ${nodes})::int`,
        allocationsFree: sql<number>`(select count(*) from ${allocations} where server_id is null)::int`,
      })
      .from(sql`(select 1) as _`);

    return totals ?? { servers: 0, users: 0, nodes: 0, allocationsFree: 0 };
  }
}
