CREATE TABLE "reseller_quotas" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"memory_mb" integer,
	"disk_mb" integer,
	"servers_max" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reseller_quotas" ADD CONSTRAINT "reseller_quotas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;