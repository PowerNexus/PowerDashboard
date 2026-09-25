-- Historique des pannes des nodes, pour publier une disponibilité sans l'inventer.
--
-- `uptime_tracked_since` vaut l'instant de cette migration pour les nodes
-- existants : leur passé n'a pas été consigné et ne compte pas.
CREATE TABLE "node_outages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"maintenance" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "uptime_tracked_since" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "node_outages" ADD CONSTRAINT "node_outages_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "node_outage_node_started_idx" ON "node_outages" USING btree ("node_id","started_at");--> statement-breakpoint
-- Une panne en cours au moment de la migration est reprise, ouverte.
INSERT INTO "node_outages" ("node_id", "started_at", "maintenance")
  SELECT "id", "unreachable_since", "maintenance_mode" FROM "nodes" WHERE "unreachable_since" IS NOT NULL;
