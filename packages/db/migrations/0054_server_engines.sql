-- Moteur posé par le panel sur chaque serveur (plateforme ou modpack) : option,
-- version, chargeur, catalogue et projet du pack, fichiers posés avec leur
-- empreinte (taille:date) pour qu'une mise à jour remplace ce que le pack a
-- posé sans écraser ce que l'utilisateur a modifié, et version plus récente
-- relevée par la veille. Une ligne par serveur, effacée à la réinstallation.
--
-- server_engine_installs : la dernière installation lancée sur chaque serveur,
-- menée en tâche de fond (running, puis done avec son compte rendu ou failed
-- avec sa raison). Une ligne par serveur : c'est aussi le verrou qui interdit
-- deux installations à la fois.
CREATE TABLE "server_engine_installs" (
	"server_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(8) NOT NULL,
	"option_id" varchar(160) NOT NULL,
	"version_id" varchar(120) NOT NULL,
	"label" varchar(200) NOT NULL,
	"report" jsonb,
	"error" varchar(1000),
	"started_by" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "server_engines" (
	"server_id" uuid PRIMARY KEY NOT NULL,
	"kind" varchar(8) NOT NULL,
	"option_id" varchar(160) NOT NULL,
	"label" varchar(200) NOT NULL,
	"version_id" varchar(120) NOT NULL,
	"version_label" varchar(200) NOT NULL,
	"version_published_at" timestamp with time zone,
	"game_version" varchar(40) DEFAULT '' NOT NULL,
	"loader" varchar(80),
	"pack_source" "marketplace_source",
	"pack_project_id" varchar(120),
	"files" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"latest_version_id" varchar(120),
	"latest_version_label" varchar(200),
	"checked_at" timestamp with time zone,
	"installed_by" uuid,
	"installed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "server_engine_installs" ADD CONSTRAINT "server_engine_installs_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_engine_installs" ADD CONSTRAINT "server_engine_installs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_engines" ADD CONSTRAINT "server_engines_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_engines" ADD CONSTRAINT "server_engines_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;