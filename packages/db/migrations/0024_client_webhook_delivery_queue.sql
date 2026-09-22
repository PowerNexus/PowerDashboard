ALTER TABLE "webhook_deliveries" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "abandoned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "webhook_delivery_due_idx" ON "webhook_deliveries" USING btree ("next_attempt_at");