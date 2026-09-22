ALTER TABLE "sessions" ADD COLUMN "token_hash" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_hash_unique" ON "sessions" USING btree ("token_hash");