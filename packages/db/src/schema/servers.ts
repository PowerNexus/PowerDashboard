import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { id, moment, timestamps } from "../columns";
import { eggs, eggVariables } from "./catalogue";
import { serverState, transferState } from "./enums";
import { users } from "./identity";
import { allocations, nodes } from "./infrastructure";

/** §6.4 — Serveurs. */

export const servers = pgTable(
  "servers",
  {
    /**
     * L'identifiant est celui que Wings connaît. À la migration depuis
     * Pterodactyl il est **repris tel quel** : le daemon nomme les volumes
     * d'après lui (`/var/lib/pterodactyl/volumes/<uuid>`), en générer un
     * nouveau reviendrait à perdre les données de tous les serveurs
     * (annexe C du plan).
     */
    id: id(),
    /** Forme courte affichée dans l'interface, dérivée de l'uuid. */
    uuidShort: varchar("uuid_short", { length: 8 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),

    ownerId: uuid("owner_id")
      .notNull()
      // Restrict : supprimer un compte ne doit pas détruire des serveurs en
      // fonctionnement. Le transfert de propriété est un acte explicite.
      .references(() => users.id, { onDelete: "restrict" }),
    /**
     * Revendeur sous lequel ce serveur a été provisionné. `null` : plateforme.
     *
     * Jusqu'ici, le rattachement se déduisait de la machine : « les serveurs
     * d'un revendeur sont ceux qui tournent sur ses machines ». Cela ne tient
     * plus dès qu'une machine porte **plusieurs** revendeurs — le node ne dit
     * alors plus à qui revient chaque serveur.
     *
     * `set null` et non `restrict` : un compte revendeur supprimé ne doit pas
     * emporter les serveurs de ses clients, qui continuent de tourner. Ils
     * repassent à la plateforme, ce qui est exactement ce qui se produit dans
     * les faits.
     */
    resellerId: uuid("reseller_id").references(() => users.id, { onDelete: "set null" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "restrict" }),
    eggId: uuid("egg_id")
      .notNull()
      .references(() => eggs.id, { onDelete: "restrict" }),
    allocationId: uuid("allocation_id")
      .notNull()
      .references(() => allocations.id, { onDelete: "restrict" }),

    dockerImage: varchar("docker_image", { length: 255 }).notNull(),
    startup: text("startup").notNull(),
    environment: jsonb("environment").notNull().default({}),

    memoryMb: integer("memory_mb").notNull(),
    swapMb: integer("swap_mb").notNull().default(0),
    diskMb: integer("disk_mb").notNull(),
    ioWeight: integer("io_weight").notNull().default(500),
    cpuPct: integer("cpu_pct").notNull().default(0),
    threads: varchar("threads", { length: 64 }),
    oomKiller: boolean("oom_killer").notNull().default(false),

    /**
     * État de gestion, propre au panel. `null` signifie « rien en cours » :
     * l'état du conteneur vient de Wings et n'est pas dupliqué ici (§8.2).
     */
    state: serverState("state"),
    suspendedReason: text("suspended_reason"),
    /** Référence dans un système de facturation externe (§7.1). */
    externalId: varchar("external_id", { length: 255 }),

    backupLimit: integer("backup_limit").notNull().default(0),
    databaseLimit: integer("database_limit").notNull().default(0),
    allocationLimit: integer("allocation_limit").notNull().default(0),

    installedAt: moment("installed_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("server_uuid_short_unique").on(table.uuidShort),
    uniqueIndex("server_external_id_unique").on(table.externalId),
    index("server_owner_idx").on(table.ownerId),
    index("server_node_idx").on(table.nodeId),
  ],
);

export const serverSubusers = pgTable(
  "server_subusers",
  {
    id: id(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rolePreset: varchar("role_preset", { length: 40 }),
    /**
     * Les permissions sont stockées en clair, pas résolues depuis le preset :
     * changer la définition d'un preset ne doit pas élargir rétroactivement
     * les droits de personnes déjà invitées.
     */
    permissions: text("permissions").array().notNull().default([]),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    acceptedAt: moment("accepted_at"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("subuser_server_user_unique").on(table.serverId, table.userId),
    index("subuser_user_idx").on(table.userId),
  ],
);

export const serverInvites = pgTable(
  "server_invites",
  {
    id: id(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    tokenHash: text("token_hash").notNull(),
    permissions: text("permissions").array().notNull().default([]),
    /**
     * Qui invite.
     *
     * Deux usages, et le second est une règle de sécurité : afficher « untel
     * vous propose l'accès » — on n'accepte pas un pouvoir offert par un
     * inconnu — et vérifier **au moment d'accepter** que cette personne détient
     * encore ce qu'elle a promis. Sans cela, inviter largement puis se faire
     * retirer ses propres droits laisserait une porte ouverte pendant toute la
     * durée de validité du lien.
     */
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: moment("expires_at").notNull(),
    acceptedAt: moment("accepted_at"),
    ...timestamps,
  },
  (table) => [
    index("invite_server_idx").on(table.serverId),
    // Comme les sessions et les jetons courrier : le condensat est la clé de
    // recherche, et deux invitations ne peuvent pas partager un jeton.
    uniqueIndex("invite_token_hash_unique").on(table.tokenHash),
  ],
);

export const serverTransfers = pgTable(
  "server_transfers",
  {
    id: id(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    fromNodeId: uuid("from_node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "restrict" }),
    toNodeId: uuid("to_node_id")
      .notNull()
      .references(() => nodes.id, { onDelete: "restrict" }),
    state: transferState("state").notNull().default("pending"),
    progressPct: integer("progress_pct").notNull().default(0),
    failureReason: text("failure_reason"),
    archivedAt: moment("archived_at"),
    ...timestamps,
  },
  (table) => [index("transfer_server_idx").on(table.serverId)],
);

export const serverVariables = pgTable(
  "server_variables",
  {
    id: id(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    eggVariableId: uuid("egg_variable_id")
      .notNull()
      .references(() => eggVariables.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("server_variable_unique").on(table.serverId, table.eggVariableId)],
);

/** Partitionnée par jour, rétention 30 j, agrégats 5 min / 1 h (§6.4). */
export const serverMetrics = pgTable(
  "server_metrics",
  {
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    at: moment("at").notNull(),
    /** État rapporté par Wings à l'instant de la mesure, conservé pour l'historique. */
    state: varchar("state", { length: 20 }).notNull(),
    cpuPct: real("cpu_pct").notNull(),
    /*
     * `bigint` et non `integer` : le plafond d'un `integer` est 2 Gio. Un
     * serveur ordinaire le dépasse en disque dès son premier monde, et ses
     * compteurs réseau cumulés en quelques heures ; l'insertion échouait alors
     * sans bruit, et le serveur n'avait aucun historique. `mode: "number"`
     * reste exact jusqu'à 8 Pio, bien au-delà de tout volume.
     */
    memBytes: bigint("mem_bytes", { mode: "number" }).notNull(),
    diskBytes: bigint("disk_bytes", { mode: "number" }).notNull(),
    netRx: bigint("net_rx", { mode: "number" }).notNull(),
    netTx: bigint("net_tx", { mode: "number" }).notNull(),
    /** Nul quand la sonde n'a pas abouti : zéro joueur et mesure absente diffèrent. */
    players: integer("players"),
  },
  (table) => [index("server_metric_server_at_idx").on(table.serverId, table.at)],
);

/** Résultat des sondes de jeu, exécutées par le worker puisque Wings ne les expose pas (§8.2). */
export const serverHealth = pgTable(
  "server_health",
  {
    id: id(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    at: moment("at").notNull(),
    reachable: boolean("reachable").notNull(),
    queryPayload: jsonb("query_payload"),
  },
  (table) => [index("server_health_server_at_idx").on(table.serverId, table.at)],
);

export const serversRelations = relations(servers, ({ one, many }) => ({
  owner: one(users, { fields: [servers.ownerId], references: [users.id] }),
  node: one(nodes, { fields: [servers.nodeId], references: [nodes.id] }),
  egg: one(eggs, { fields: [servers.eggId], references: [eggs.id] }),
  allocation: one(allocations, { fields: [servers.allocationId], references: [allocations.id] }),
  subusers: many(serverSubusers),
  variables: many(serverVariables),
}));
