import {
  boolean,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { id, moment, timestamps } from "../columns";
import {
  actorType,
  announcementLevel,
  incidentImpact,
  incidentStatus,
  notificationChannel,
} from "./enums";
import { users } from "./identity";
import { servers } from "./servers";

/** §6.6 — Transverse. */

/**
 * Journal d'audit, en ajout seul (§5.4).
 *
 * L'acteur est en `set null` et non en cascade : supprimer un compte ne doit
 * pas effacer la trace de ce qu'il a fait. Le journal perdrait sa raison d'être
 * si l'effacement d'un utilisateur suffisait à effacer ses actions.
 */
export const activityLogs = pgTable(
  "activity_logs",
  {
    id: id(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorType: actorType("actor_type").notNull(),
    /** Conservé en clair : l'acteur supprimé doit rester identifiable dans le journal. */
    actorLabel: varchar("actor_label", { length: 255 }).notNull(),
    serverId: uuid("server_id").references(() => servers.id, { onDelete: "set null" }),
    event: varchar("event", { length: 120 }).notNull(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    properties: jsonb("properties").notNull().default({}),
    at: moment("at").notNull(),
  },
  (table) => [
    index("activity_actor_idx").on(table.actorId, table.at),
    index("activity_server_idx").on(table.serverId, table.at),
    index("activity_event_idx").on(table.event, table.at),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 120 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body").notNull(),
    data: jsonb("data").notNull().default({}),
    channel: notificationChannel("channel").notNull().default("inapp"),
    readAt: moment("read_at"),
    ...timestamps,
  },
  (table) => [index("notification_user_idx").on(table.userId, table.readAt)],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 120 }).notNull(),
    channels: text("channels").array().notNull().default([]),
    ...timestamps,
  },
  (table) => [uniqueIndex("notification_pref_unique").on(table.userId, table.event)],
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: id(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    serverId: uuid("server_id").references(() => servers.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** Chiffré : sert à signer les livraisons, sa fuite permet de les contrefaire. */
    secretEnc: text("secret_enc").notNull(),
    events: text("events").array().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [index("webhook_owner_idx").on(table.ownerId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 120 }).notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    /** Nul tant qu'aucune réponse n'est parvenue : distinct d'un échec HTTP. */
    responseStatus: integer("response_status"),
    /** Tronquée : on garde de quoi diagnostiquer, pas la page d'erreur entière. */
    responseBody: text("response_body"),
    /**
     * Nombre de tentatives **effectuées**. Zéro tant que rien n'est parti.
     *
     * Aligné sur `application_webhook_deliveries`, et ce n'est pas cosmétique :
     * les deux files sont vidées par le **même** répartiteur. Deux colonnes de
     * sens voisin mais de nom et de départ différents — l'ancienne `attempt`
     * commençait à un — l'auraient obligé à compter deux fois, donc à se
     * tromper une fois sur deux.
     */
    attempts: integer("attempts").notNull().default(0),
    /** Quand tenter. `null` signifie « plus jamais » — livré, ou abandonné. */
    nextAttemptAt: moment("next_attempt_at"),
    deliveredAt: moment("delivered_at"),
    /** Renseigné quand on renonce, avec la raison du dernier échec. */
    abandonedAt: moment("abandoned_at"),
    ...timestamps,
  },
  (table) => [
    index("webhook_delivery_webhook_idx").on(table.webhookId, table.createdAt),
    // La file du répartiteur : il ne lit que les lignes dont l'heure est venue,
    // ce qui rend l'attente gratuite. Sans cet index, chaque tour balaierait
    // tout l'historique pour n'en retenir aucune.
    index("webhook_delivery_due_idx").on(table.nextAttemptAt),
  ],
);

export const announcements = pgTable("announcements", {
  id: id(),
  title: varchar("title", { length: 255 }).notNull(),
  bodyMd: text("body_md").notNull(),
  level: announcementLevel("level").notNull().default("info"),
  startsAt: moment("starts_at").notNull(),
  endsAt: moment("ends_at"),
  audience: text("audience").array().notNull().default([]),
  ...timestamps,
});

export const incidents = pgTable("incidents", {
  id: id(),
  title: varchar("title", { length: 255 }).notNull(),
  status: incidentStatus("status").notNull().default("investigating"),
  impact: incidentImpact("impact").notNull().default("minor"),
  nodeIds: uuid("node_ids").array().notNull().default([]),
  /** Historique des mises à jour, du plus ancien au plus récent. */
  updates: jsonb("updates").notNull().default([]),
  resolvedAt: moment("resolved_at"),
  ...timestamps,
});

export const settings = pgTable(
  "settings",
  {
    id: id(),
    key: varchar("key", { length: 120 }).notNull(),
    value: jsonb("value").notNull(),
    /** Vrai pour une valeur chiffrée (clé d'API, mot de passe SMTP) : jamais renvoyée telle quelle. */
    isSecret: boolean("is_secret").notNull().default(false),
    ...timestamps,
  },
  (table) => [uniqueIndex("setting_key_unique").on(table.key)],
);

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: id(),
    key: varchar("key", { length: 120 }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    rolloutPct: integer("rollout_pct").notNull().default(0),
    audience: text("audience").array().notNull().default([]),
    ...timestamps,
  },
  (table) => [uniqueIndex("feature_flag_key_unique").on(table.key)],
);
