import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { id, moment, timestamps } from "../columns";
import { backupDisk, marketplaceSource, scheduleAction } from "./enums";
import { users } from "./identity";
import { nodes } from "./infrastructure";
import { servers } from "./servers";

/** §6.5 — Fonctionnalités serveur. */

export const backups = pgTable(
  "backups",
  {
    id: id(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    ignoredFiles: text("ignored_files").array().notNull().default([]),
    disk: backupDisk("disk").notNull().default("local"),
    checksum: varchar("checksum", { length: 128 }),
    bytes: integer("bytes").notNull().default(0),
    /**
     * Nul tant que la sauvegarde est en cours. Un booléen à `false` par défaut
     * ferait passer une sauvegarde en cours pour une sauvegarde ratée.
     */
    isSuccessful: boolean("is_successful"),
    /**
     * Identifiant du téléversement fractionné en cours, côté S3.
     *
     * Nul pour une sauvegarde locale, et pour une sauvegarde distante déjà
     * close : la colonne dit « un dépôt est en cours », pas « cette sauvegarde
     * est distante » — ce que `disk` dit déjà.
     */
    uploadId: text("upload_id"),
    /** Une sauvegarde verrouillée échappe à la rotation de rétention. */
    isLocked: boolean("is_locked").notNull().default(false),
    completedAt: moment("completed_at"),
    expiresAt: moment("expires_at"),
    ...timestamps,
  },
  (table) => [index("backup_server_idx").on(table.serverId)],
);

/*
 * Il y avait ici `backup_schedules` : un second moyen de planifier des
 * sauvegardes, avec sa propre expression cron, sa rétention et sa liste
 * d'exclusions. Vide depuis le premier jour, retirée en 0029.
 *
 * `schedules` le fait déjà, par une tâche d'action « backup ». Deux mécanismes
 * pour la même chose, dont un seul tourne — et celui qui ne tournait pas était
 * le mieux doté sur le papier, ce qui est la façon la plus sûre de faire perdre
 * une heure à qui arrive après.
 */

export const databaseHosts = pgTable("database_hosts", {
  id: id(),
  name: varchar("name", { length: 100 }).notNull(),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(3306),
  username: varchar("username", { length: 100 }).notNull(),
  passwordEnc: text("password_enc").notNull(),
  /** Restreint le host à un node, quand il vit sur la même machine. */
  nodeId: uuid("node_id").references(() => nodes.id, { onDelete: "set null" }),
  maxDatabases: integer("max_databases"),
  ...timestamps,
});

export const databases = pgTable(
  "databases",
  {
    id: id(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    databaseHostId: uuid("database_host_id")
      .notNull()
      .references(() => databaseHosts.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 120 }).notNull(),
    username: varchar("username", { length: 100 }).notNull(),
    /**
     * Chiffré, et non haché : contrairement à un mot de passe de connexion au
     * panel, celui-ci doit pouvoir être réaffiché au client qui l'a perdu.
     */
    passwordEnc: text("password_enc").notNull(),
    remote: varchar("remote", { length: 255 }).notNull().default("%"),
    maxConnections: integer("max_connections"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("database_host_name_unique").on(table.databaseHostId, table.name),
    index("database_server_idx").on(table.serverId),
  ],
);

export const schedules = pgTable(
  "schedules",
  {
    id: id(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    cronMinute: varchar("cron_minute", { length: 40 }).notNull().default("*"),
    cronHour: varchar("cron_hour", { length: 40 }).notNull().default("*"),
    cronDayOfMonth: varchar("cron_dom", { length: 40 }).notNull().default("*"),
    cronMonth: varchar("cron_month", { length: 40 }).notNull().default("*"),
    cronDayOfWeek: varchar("cron_dow", { length: 40 }).notNull().default("*"),
    isActive: boolean("is_active").notNull().default(true),
    /** Évite qu'une tâche récurrente redémarre en boucle un serveur arrêté volontairement. */
    onlyWhenOnline: boolean("only_when_online").notNull().default(true),
    lastRunAt: moment("last_run_at"),
    /**
     * Cause de l'échec de la dernière exécution, `null` si elle a réussi.
     *
     * Sans cette colonne, une planification qui échoue le fait **en silence et
     * pour toujours** : la cause partait dans le journal applicatif, que le
     * client ne lit pas et ne peut pas lire. Il continuait à croire que ses
     * sauvegardes se faisaient.
     */
    lastRunFailure: text("last_run_failure"),
    /**
     * Quand le propriétaire a été prévenu du dérangement en cours.
     *
     * Posée à la première exécution ratée, effacée au premier succès. Une
     * planification cassée échoue à chaque tour : sans cette borne, une tâche
     * horaire enverrait vingt-quatre messages par jour, et la vingt-cinquième
     * personne à les recevoir aurait coupé les notifications.
     */
    failureNotifiedAt: moment("failure_notified_at"),
    nextRunAt: moment("next_run_at"),
    ...timestamps,
  },
  (table) => [
    index("schedule_server_idx").on(table.serverId),
    // Le planificateur balaye par échéance : sans cet index il lirait toute
    // la table à chaque tick.
    index("schedule_next_run_idx").on(table.nextRunAt).where(sql`is_active`),
  ],
);

export const scheduleTasks = pgTable(
  "schedule_tasks",
  {
    id: id(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    action: scheduleAction("action").notNull(),
    payload: text("payload").notNull().default(""),
    /** Délai en secondes avant l'exécution, une fois la tâche précédente terminée. */
    timeOffset: integer("time_offset").notNull().default(0),
    continueOnFailure: boolean("continue_on_failure").notNull().default(false),
    ...timestamps,
  },
  (table) => [uniqueIndex("schedule_task_sequence_unique").on(table.scheduleId, table.sequence)],
);

export const mounts = pgTable("mounts", {
  id: id(),
  name: varchar("name", { length: 120 }).notNull(),
  source: text("source").notNull(),
  target: text("target").notNull(),
  readOnly: boolean("read_only").notNull().default(true),
  /** Un montage non « user_mountable » ne peut être attaché que par un administrateur. */
  userMountable: boolean("user_mountable").notNull().default(false),
  ...timestamps,
});

export const serverMounts = pgTable(
  "server_mounts",
  {
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    mountId: uuid("mount_id")
      .notNull()
      .references(() => mounts.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("server_mount_unique").on(table.serverId, table.mountId)],
);

/** Ce que le marketplace a effectivement déposé dans le conteneur (§10). */
export const marketplaceInstalls = pgTable(
  "marketplace_installs",
  {
    id: id(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    source: marketplaceSource("source").notNull(),
    projectId: varchar("project_id", { length: 120 }).notNull(),
    versionId: varchar("version_id", { length: 120 }).notNull(),
    /**
     * Les fichiers réellement écrits, pour pouvoir désinstaller. Sans cette
     * trace, retirer un plugin reviendrait à deviner son nom de fichier.
     */
    installedFiles: text("installed_files").array().notNull().default([]),
    installedBy: uuid("installed_by").references(() => users.id, { onDelete: "set null" }),
    installedAt: moment("installed_at").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("marketplace_install_unique").on(table.serverId, table.source, table.projectId),
  ],
);
