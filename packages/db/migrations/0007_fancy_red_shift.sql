CREATE TABLE "application_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event" varchar(120) NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"response_status" integer,
	"response_body" text,
	"delivered_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_key_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret_enc" text NOT NULL,
	"events" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_webhook_deliveries" ADD CONSTRAINT "application_webhook_deliveries_webhook_id_application_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."application_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_webhooks" ADD CONSTRAINT "application_webhooks_application_key_id_application_keys_id_fk" FOREIGN KEY ("application_key_id") REFERENCES "public"."application_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_webhook_delivery_due_idx" ON "application_webhook_deliveries" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "application_webhook_delivery_hook_idx" ON "application_webhook_deliveries" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX "application_webhook_key_idx" ON "application_webhooks" USING btree ("application_key_id");