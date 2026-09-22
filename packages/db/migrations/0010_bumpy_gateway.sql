ALTER TABLE "egg_variables" ALTER COLUMN "rules" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "egg_variables" ALTER COLUMN "rules" SET DEFAULT 'required|string';