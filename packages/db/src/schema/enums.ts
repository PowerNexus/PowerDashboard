import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Énumérations PostgreSQL.
 *
 * Elles doublent volontairement les `z.enum` de `@gamedashboard/contracts` : la base
 * doit refuser une valeur invalide même si elle arrive par une migration, un
 * script d'import ou une console psql, c'est-à-dire par un chemin où Zod n'a
 * jamais été exécuté. Un test de cohérence (`enums.test.ts`) garantit que les
 * deux listes ne divergent pas.
 */

export const userRole = pgEnum("user_role", ["admin", "support", "reseller", "user"]);

/**
 * Fournisseurs d'identité.
 *
 * « oidc » désigne celui que l'exploitant configure lui-même — Authentik,
 * Keycloak, Azure, n'importe lequel. Les deux autres sont réservés aux
 * boutons dédiés prévus au plan, qui portent leur propre marque.
 */
export const oauthProvider = pgEnum("oauth_provider", ["google", "discord", "oidc"]);

export const actorType = pgEnum("actor_type", ["user", "api_key", "system"]);

/**
 * État de gestion d'un serveur, au sens du panel.
 *
 * L'état du conteneur (`offline`, `starting`, `running`, `stopping`) n'est
 * délibérément pas stocké : il appartient à Wings, qui le rapporte en direct.
 * Le dupliquer en base produirait une seconde vérité qui finirait par mentir
 * (§8.2 du plan). `null` signifie « aucun état de gestion en cours ».
 */
export const serverState = pgEnum("server_state", [
  "installing",
  "install_failed",
  "suspended",
  "restoring",
  "transferring",
]);

export const backupDisk = pgEnum("backup_disk", ["local", "s3"]);

export const eggSourceType = pgEnum("egg_source_type", ["git", "url", "manual"]);

export const marketplaceSource = pgEnum("marketplace_source", [
  "modrinth",
  "curseforge",
  "spigot",
  "custom",
]);

export const scheduleAction = pgEnum("schedule_action", [
  "command",
  "power",
  "backup",
  "restart_if_crashed",
  "webhook",
]);

export const transferState = pgEnum("transfer_state", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const notificationChannel = pgEnum("notification_channel", ["inapp", "email", "discord"]);

export const announcementLevel = pgEnum("announcement_level", ["info", "warning", "critical"]);

export const incidentStatus = pgEnum("incident_status", [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
]);

export const incidentImpact = pgEnum("incident_impact", ["none", "minor", "major", "critical"]);
