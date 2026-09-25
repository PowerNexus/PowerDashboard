import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { id, moment, timestamps } from "../columns";
import { eggSourceType } from "./enums";

/** §6.3 — Catalogue : familles de jeux, eggs, sources. */

export const nests = pgTable("nests", {
  id: id(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  ...timestamps,
});

/**
 * Egg au format Pterodactyl v2.
 *
 * Le format n'est pas seulement importé : il est **servi à Wings** par
 * `/api/remote/servers/:uuid` (§7.5). Les champs qui le composent sont donc
 * stockés tels quels, en jsonb, plutôt que décomposés en colonnes qui ne
 * sauraient pas le restituer sans perte.
 */
export const eggs = pgTable(
  "eggs",
  {
    id: id(),
    nestId: uuid("nest_id")
      .notNull()
      .references(() => nests.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    author: varchar("author", { length: 255 }),

    dockerImages: jsonb("docker_images").notNull().default({}),
    startup: text("startup").notNull(),
    configFiles: jsonb("config_files").notNull().default({}),
    configStartup: jsonb("config_startup").notNull().default({}),
    configStop: varchar("config_stop", { length: 255 }),
    configLogs: jsonb("config_logs").notNull().default({}),

    installScript: text("install_script").notNull().default(""),
    installContainer: varchar("install_container", { length: 255 }).notNull(),
    installEntrypoint: varchar("install_entrypoint", { length: 64 }).notNull().default("bash"),

    features: text("features").array().notNull().default([]),
    fileDenylist: text("file_denylist").array().notNull().default([]),
    /**
     * Commandes du jeu proposées à la saisie dans la console, une par entrée,
     * arguments entre chevrons : `whitelist add <joueur>` (PLAN §10.2). Rien
     * d'exécuté : ce sont des suggestions, la console envoie ce qu'on tape.
     */
    consoleCommands: text("console_commands").array().notNull().default([]),
    /**
     * Commandes de la vue joueurs (`kick {player} {reason}`…), extension propre
     * à GameDashboard. Jamais servie à Wings : le panel les tape lui-même dans
     * la console.
     */
    playerCommands: jsonb("player_commands").notNull().default({}),

    /** Provenance, pour distinguer un egg importé d'un egg écrit à la main (§8.3). */
    sourceId: uuid("source_id").references(() => eggSources.id, { onDelete: "set null" }),
    sourceRef: varchar("source_ref", { length: 255 }),
    importedAt: moment("imported_at"),
    /**
     * Vrai dès qu'un administrateur a édité l'egg après import. La
     * synchronisation cesse alors d'écraser : elle signale un écart et laisse
     * l'arbitrage à l'administrateur (§8.3).
     */
    locallyModified: boolean("locally_modified").notNull().default(false),
    /** Un egg importé n'est pas proposé aux clients tant qu'il n'est pas activé (§8.3). */
    enabled: boolean("enabled").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("egg_nest_idx").on(table.nestId),
    uniqueIndex("egg_source_ref_unique").on(table.sourceId, table.sourceRef),
  ],
);

export const eggVariables = pgTable(
  "egg_variables",
  {
    id: id(),
    eggId: uuid("egg_id")
      .notNull()
      .references(() => eggs.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    envVariable: varchar("env_variable", { length: 120 }).notNull(),
    description: text("description"),
    defaultValue: text("default_value").notNull().default(""),
    userViewable: boolean("user_viewable").notNull().default(true),
    /**
     * Une variable non éditable reste refusée côté serveur même si le client
     * la soumet : la case décochée dans l'interface n'est qu'un affichage,
     * la règle est appliquée à l'écriture.
     */
    userEditable: boolean("user_editable").notNull().default(false),
    /**
     * Règles de validation, au format Laravel, telles que l'egg les porte.
     *
     * `text` et non `varchar(255)` : la longueur est décidée par l'auteur de
     * l'egg, pas par nous. Les eggs officiels en dépassent régulièrement —
     * « required|string|in: » suivi des deux cent quarante-neuf codes pays ISO,
     * ou de la liste des cartes d'un jeu. Tronquer serait pire que refuser :
     * une liste `in:` coupée en son milieu rejetterait des valeurs parfaitement
     * valides, sans que rien n'indique pourquoi.
     */
    rules: text("rules").notNull().default("required|string"),
    ...timestamps,
  },
  (table) => [uniqueIndex("egg_variable_env_unique").on(table.eggId, table.envVariable)],
);

/** Dépôts d'eggs suivis (`pterodactyl/game-eggs` en source principale, §8.3). */
export const eggSources = pgTable("egg_sources", {
  id: id(),
  name: varchar("name", { length: 120 }).notNull(),
  type: eggSourceType("type").notNull(),
  url: text("url").notNull(),
  branch: varchar("branch", { length: 120 }).notNull().default("main"),
  pathGlob: varchar("path_glob", { length: 255 }).notNull().default("**/*.json"),
  autoSync: boolean("auto_sync").notNull().default(false),
  /** Commit épinglé de la dernière synchronisation réussie, pour la reproductibilité. */
  lastSyncedRef: varchar("last_synced_ref", { length: 64 }),
  lastSyncedAt: moment("last_synced_at"),
  ...timestamps,
});

/*
 * Il y avait ici `marketplace_sources` : les sources du catalogue en base,
 * avec un réglage par source. Vide depuis le premier jour, retirée en 0029.
 *
 * Les sources sont en dur dans le code — Modrinth, CurseForge, SpigotMC — et
 * la seule qui demandait une configuration, la clé CurseForge, a désormais son
 * réglage de plateforme. Une table vide qui promet un écran d'administration
 * inexistant coûte plus qu'elle ne prépare.
 */

export const nestsRelations = relations(nests, ({ many }) => ({ eggs: many(eggs) }));

export const eggsRelations = relations(eggs, ({ one, many }) => ({
  nest: one(nests, { fields: [eggs.nestId], references: [nests.id] }),
  source: one(eggSources, { fields: [eggs.sourceId], references: [eggSources.id] }),
  variables: many(eggVariables),
}));
