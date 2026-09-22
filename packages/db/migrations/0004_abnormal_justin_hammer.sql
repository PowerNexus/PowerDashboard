ALTER TABLE "users" ADD COLUMN "allows_platform_provisioning" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "node_owner_idx" ON "nodes" USING btree ("owner_id");