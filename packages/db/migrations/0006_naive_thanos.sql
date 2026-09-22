CREATE TABLE "application_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"prefix" varchar(32) NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"allowed_ips" text[] DEFAULT '{}' NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_key_id" uuid NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"endpoint" varchar(200) NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_keys" ADD CONSTRAINT "application_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_application_key_id_application_keys_id_fk" FOREIGN KEY ("application_key_id") REFERENCES "public"."application_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_key_prefix_unique" ON "application_keys" USING btree ("prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_scope_unique" ON "idempotency_records" USING btree ("application_key_id","idempotency_key");