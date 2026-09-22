CREATE TYPE "public"."actor_type" AS ENUM('user', 'api_key', 'system');--> statement-breakpoint
CREATE TYPE "public"."announcement_level" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."backup_disk" AS ENUM('local', 's3');--> statement-breakpoint
CREATE TYPE "public"."egg_source_type" AS ENUM('git', 'url', 'manual');--> statement-breakpoint
CREATE TYPE "public"."incident_impact" AS ENUM('none', 'minor', 'major', 'critical');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('investigating', 'identified', 'monitoring', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."marketplace_source" AS ENUM('modrinth', 'curseforge', 'spigot', 'custom');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('inapp', 'email', 'discord');--> statement-breakpoint
CREATE TYPE "public"."oauth_provider" AS ENUM('google', 'discord');--> statement-breakpoint
CREATE TYPE "public"."schedule_action" AS ENUM('command', 'power', 'backup', 'restart_if_crashed', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."server_state" AS ENUM('installing', 'install_failed', 'suspended', 'restoring', 'transferring');--> statement-breakpoint
CREATE TYPE "public"."transfer_state" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'support', 'reseller', 'user');--> statement-breakpoint
CREATE TABLE "egg_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" "egg_source_type" NOT NULL,
	"url" text NOT NULL,
	"branch" varchar(120) DEFAULT 'main' NOT NULL,
	"path_glob" varchar(255) DEFAULT '**/*.json' NOT NULL,
	"auto_sync" boolean DEFAULT false NOT NULL,
	"last_synced_ref" varchar(64),
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "egg_variables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"egg_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"env_variable" varchar(120) NOT NULL,
	"description" text,
	"default_value" text DEFAULT '' NOT NULL,
	"user_viewable" boolean DEFAULT true NOT NULL,
	"user_editable" boolean DEFAULT false NOT NULL,
	"rules" varchar(255) DEFAULT 'required|string' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eggs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nest_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"author" varchar(255),
	"docker_images" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"startup" text NOT NULL,
	"config_files" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config_startup" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"config_stop" varchar(255),
	"config_logs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"install_script" text DEFAULT '' NOT NULL,
	"install_container" varchar(255) NOT NULL,
	"install_entrypoint" varchar(64) DEFAULT 'bash' NOT NULL,
	"features" text[] DEFAULT '{}' NOT NULL,
	"file_denylist" text[] DEFAULT '{}' NOT NULL,
	"source_id" uuid,
	"source_ref" varchar(255),
	"imported_at" timestamp with time zone,
	"locally_modified" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "marketplace_source" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"cron" varchar(120) NOT NULL,
	"retention_count" integer DEFAULT 3 NOT NULL,
	"ignored_files" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"ignored_files" text[] DEFAULT '{}' NOT NULL,
	"disk" "backup_disk" DEFAULT 'local' NOT NULL,
	"checksum" varchar(128),
	"bytes" integer DEFAULT 0 NOT NULL,
	"is_successful" boolean,
	"is_locked" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "database_hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer DEFAULT 3306 NOT NULL,
	"username" varchar(100) NOT NULL,
	"password_enc" text NOT NULL,
	"node_id" uuid,
	"max_databases" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "databases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"database_host_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"username" varchar(100) NOT NULL,
	"password_enc" text NOT NULL,
	"remote" varchar(255) DEFAULT '%' NOT NULL,
	"max_connections" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_installs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"source" "marketplace_source" NOT NULL,
	"project_id" varchar(120) NOT NULL,
	"version_id" varchar(120) NOT NULL,
	"installed_files" text[] DEFAULT '{}' NOT NULL,
	"installed_by" uuid,
	"installed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"source" text NOT NULL,
	"target" text NOT NULL,
	"read_only" boolean DEFAULT true NOT NULL,
	"user_mountable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"action" "schedule_action" NOT NULL,
	"payload" text DEFAULT '' NOT NULL,
	"time_offset" integer DEFAULT 0 NOT NULL,
	"continue_on_failure" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"cron_minute" varchar(40) DEFAULT '*' NOT NULL,
	"cron_hour" varchar(40) DEFAULT '*' NOT NULL,
	"cron_dom" varchar(40) DEFAULT '*' NOT NULL,
	"cron_month" varchar(40) DEFAULT '*' NOT NULL,
	"cron_dow" varchar(40) DEFAULT '*' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"only_when_online" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_mounts" (
	"server_id" uuid NOT NULL,
	"mount_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"prefix" varchar(32) NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"allowed_ips" text[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"ip" "inet" NOT NULL,
	"success" boolean NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"device_label" varchar(120),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssh_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_oauth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "oauth_provider" NOT NULL,
	"provider_user_id" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}' NOT NULL,
	"label" varchar(100) NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_credentials_totp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret_enc" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text,
	"name_first" varchar(100) NOT NULL,
	"name_last" varchar(100) NOT NULL,
	"locale" varchar(10) DEFAULT 'fr' NOT NULL,
	"timezone" varchar(64) DEFAULT 'Europe/Paris' NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"is_2fa_enabled" boolean DEFAULT false NOT NULL,
	"external_id" varchar(255),
	"avatar_url" text,
	"email_verified_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"ip" varchar(45) NOT NULL,
	"ip_alias" varchar(255),
	"port" integer NOT NULL,
	"server_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"short" varchar(20) NOT NULL,
	"long" varchar(120) NOT NULL,
	"country_code" char(2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_metrics" (
	"node_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"cpu_pct" real NOT NULL,
	"mem_used_mb" integer NOT NULL,
	"disk_used_mb" integer NOT NULL,
	"net_rx" integer NOT NULL,
	"net_tx" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"location_id" uuid NOT NULL,
	"category" varchar(60),
	"subcategory" varchar(60),
	"fqdn" varchar(255) NOT NULL,
	"scheme" varchar(5) DEFAULT 'https' NOT NULL,
	"daemon_port" integer DEFAULT 8080 NOT NULL,
	"daemon_sftp_port" integer DEFAULT 2022 NOT NULL,
	"memory_mb" integer NOT NULL,
	"memory_overallocate" integer DEFAULT 0 NOT NULL,
	"disk_mb" integer NOT NULL,
	"disk_overallocate" integer DEFAULT 0 NOT NULL,
	"cpu_cores" real NOT NULL,
	"public" boolean DEFAULT true NOT NULL,
	"maintenance_mode" boolean DEFAULT false NOT NULL,
	"daemon_token_id" varchar(32) NOT NULL,
	"daemon_token_enc" text NOT NULL,
	"daemon_token_rotated_at" timestamp with time zone NOT NULL,
	"wings_version" varchar(32),
	"last_heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"reachable" boolean NOT NULL,
	"query_payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "server_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"token_hash" text NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_metrics" (
	"server_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"state" varchar(20) NOT NULL,
	"cpu_pct" real NOT NULL,
	"mem_bytes" integer NOT NULL,
	"disk_bytes" integer NOT NULL,
	"net_rx" integer NOT NULL,
	"net_tx" integer NOT NULL,
	"players" integer
);
--> statement-breakpoint
CREATE TABLE "server_subusers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_preset" varchar(40),
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"invited_by" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"state" "transfer_state" DEFAULT 'pending' NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_variables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"egg_variable_id" uuid NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uuid_short" varchar(8) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"owner_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"egg_id" uuid NOT NULL,
	"allocation_id" uuid NOT NULL,
	"docker_image" varchar(255) NOT NULL,
	"startup" text NOT NULL,
	"environment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"memory_mb" integer NOT NULL,
	"swap_mb" integer DEFAULT 0 NOT NULL,
	"disk_mb" integer NOT NULL,
	"io_weight" integer DEFAULT 500 NOT NULL,
	"cpu_pct" integer DEFAULT 0 NOT NULL,
	"threads" varchar(64),
	"oom_killer" boolean DEFAULT false NOT NULL,
	"state" "server_state",
	"suspended_reason" text,
	"external_id" varchar(255),
	"backup_limit" integer DEFAULT 0 NOT NULL,
	"database_limit" integer DEFAULT 0 NOT NULL,
	"allocation_limit" integer DEFAULT 0 NOT NULL,
	"installed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"actor_label" varchar(255) NOT NULL,
	"server_id" uuid,
	"event" varchar(120) NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"body_md" text NOT NULL,
	"level" "announcement_level" DEFAULT 'info' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"audience" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(120) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"rollout_pct" integer DEFAULT 0 NOT NULL,
	"audience" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"status" "incident_status" DEFAULT 'investigating' NOT NULL,
	"impact" "incident_impact" DEFAULT 'minor' NOT NULL,
	"node_ids" uuid[] DEFAULT '{}' NOT NULL,
	"updates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event" varchar(120) NOT NULL,
	"channels" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(120) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel" "notification_channel" DEFAULT 'inapp' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(120) NOT NULL,
	"value" jsonb NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event" varchar(120) NOT NULL,
	"payload" jsonb NOT NULL,
	"response_status" integer,
	"response_body" text,
	"attempt" integer DEFAULT 1 NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"server_id" uuid,
	"url" text NOT NULL,
	"secret_enc" text NOT NULL,
	"events" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "egg_variables" ADD CONSTRAINT "egg_variables_egg_id_eggs_id_fk" FOREIGN KEY ("egg_id") REFERENCES "public"."eggs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eggs" ADD CONSTRAINT "eggs_nest_id_nests_id_fk" FOREIGN KEY ("nest_id") REFERENCES "public"."nests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eggs" ADD CONSTRAINT "eggs_source_id_egg_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."egg_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_schedules" ADD CONSTRAINT "backup_schedules_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "database_hosts" ADD CONSTRAINT "database_hosts_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "databases" ADD CONSTRAINT "databases_database_host_id_database_hosts_id_fk" FOREIGN KEY ("database_host_id") REFERENCES "public"."database_hosts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_installs" ADD CONSTRAINT "marketplace_installs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_installs" ADD CONSTRAINT "marketplace_installs_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_tasks" ADD CONSTRAINT "schedule_tasks_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_mounts" ADD CONSTRAINT "server_mounts_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_mounts" ADD CONSTRAINT "server_mounts_mount_id_mounts_id_fk" FOREIGN KEY ("mount_id") REFERENCES "public"."mounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_keys" ADD CONSTRAINT "ssh_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_oauth_accounts" ADD CONSTRAINT "user_oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_passkeys" ADD CONSTRAINT "user_passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_recovery_codes" ADD CONSTRAINT "user_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_credentials_totp" ADD CONSTRAINT "user_credentials_totp_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_metrics" ADD CONSTRAINT "node_metrics_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_health" ADD CONSTRAINT "server_health_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_invites" ADD CONSTRAINT "server_invites_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_metrics" ADD CONSTRAINT "server_metrics_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_subusers" ADD CONSTRAINT "server_subusers_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_subusers" ADD CONSTRAINT "server_subusers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_subusers" ADD CONSTRAINT "server_subusers_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_transfers" ADD CONSTRAINT "server_transfers_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_transfers" ADD CONSTRAINT "server_transfers_from_node_id_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_transfers" ADD CONSTRAINT "server_transfers_to_node_id_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_variables" ADD CONSTRAINT "server_variables_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_variables" ADD CONSTRAINT "server_variables_egg_variable_id_egg_variables_id_fk" FOREIGN KEY ("egg_variable_id") REFERENCES "public"."egg_variables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_egg_id_eggs_id_fk" FOREIGN KEY ("egg_id") REFERENCES "public"."eggs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_allocation_id_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "egg_variable_env_unique" ON "egg_variables" USING btree ("egg_id","env_variable");--> statement-breakpoint
CREATE INDEX "egg_nest_idx" ON "eggs" USING btree ("nest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "egg_source_ref_unique" ON "eggs" USING btree ("source_id","source_ref");--> statement-breakpoint
CREATE INDEX "backup_schedule_server_idx" ON "backup_schedules" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "backup_server_idx" ON "backups" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "database_host_name_unique" ON "databases" USING btree ("database_host_id","name");--> statement-breakpoint
CREATE INDEX "database_server_idx" ON "databases" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_install_unique" ON "marketplace_installs" USING btree ("server_id","source","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_task_sequence_unique" ON "schedule_tasks" USING btree ("schedule_id","sequence");--> statement-breakpoint
CREATE INDEX "schedule_server_idx" ON "schedules" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "schedule_next_run_idx" ON "schedules" USING btree ("next_run_at") WHERE is_active;--> statement-breakpoint
CREATE UNIQUE INDEX "server_mount_unique" ON "server_mounts" USING btree ("server_id","mount_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_prefix_unique" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "api_key_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "login_attempt_email_idx" ON "login_attempts" USING btree ("email","at");--> statement-breakpoint
CREATE INDEX "login_attempt_ip_idx" ON "login_attempts" USING btree ("ip","at");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ssh_key_fingerprint_unique" ON "ssh_keys" USING btree ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX "ssh_key_user_idx" ON "ssh_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_provider_identity_unique" ON "user_oauth_accounts" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "oauth_user_idx" ON "user_oauth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_unique" ON "user_passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkey_user_idx" ON "user_passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recovery_code_user_idx" ON "user_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_external_id_unique" ON "users" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_node_ip_port_unique" ON "allocations" USING btree ("node_id","ip","port");--> statement-breakpoint
CREATE INDEX "allocation_server_idx" ON "allocations" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "location_short_unique" ON "locations" USING btree ("short");--> statement-breakpoint
CREATE INDEX "node_metric_node_at_idx" ON "node_metrics" USING btree ("node_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "node_token_id_unique" ON "nodes" USING btree ("daemon_token_id");--> statement-breakpoint
CREATE INDEX "node_location_idx" ON "nodes" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "node_category_idx" ON "nodes" USING btree ("category","subcategory");--> statement-breakpoint
CREATE INDEX "server_health_server_at_idx" ON "server_health" USING btree ("server_id","at");--> statement-breakpoint
CREATE INDEX "invite_server_idx" ON "server_invites" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "server_metric_server_at_idx" ON "server_metrics" USING btree ("server_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "subuser_server_user_unique" ON "server_subusers" USING btree ("server_id","user_id");--> statement-breakpoint
CREATE INDEX "subuser_user_idx" ON "server_subusers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transfer_server_idx" ON "server_transfers" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "server_variable_unique" ON "server_variables" USING btree ("server_id","egg_variable_id");--> statement-breakpoint
CREATE UNIQUE INDEX "server_uuid_short_unique" ON "servers" USING btree ("uuid_short");--> statement-breakpoint
CREATE UNIQUE INDEX "server_external_id_unique" ON "servers" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "server_owner_idx" ON "servers" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "server_node_idx" ON "servers" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "activity_actor_idx" ON "activity_logs" USING btree ("actor_id","at");--> statement-breakpoint
CREATE INDEX "activity_server_idx" ON "activity_logs" USING btree ("server_id","at");--> statement-breakpoint
CREATE INDEX "activity_event_idx" ON "activity_logs" USING btree ("event","at");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flag_key_unique" ON "feature_flags" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_pref_unique" ON "notification_preferences" USING btree ("user_id","event");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "setting_key_unique" ON "settings" USING btree ("key");--> statement-breakpoint
CREATE INDEX "webhook_delivery_webhook_idx" ON "webhook_deliveries" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_owner_idx" ON "webhooks" USING btree ("owner_id");