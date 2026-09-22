CREATE TABLE "node_reseller_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"reseller_id" uuid NOT NULL,
	"memory_mb" integer NOT NULL,
	"disk_mb" integer NOT NULL,
	"servers_max" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "node_reseller_shares" ADD CONSTRAINT "node_reseller_shares_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_reseller_shares" ADD CONSTRAINT "node_reseller_shares_reseller_id_users_id_fk" FOREIGN KEY ("reseller_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "node_reseller_share_unique" ON "node_reseller_shares" USING btree ("node_id","reseller_id");--> statement-breakpoint
CREATE INDEX "node_reseller_share_reseller_idx" ON "node_reseller_shares" USING btree ("reseller_id");