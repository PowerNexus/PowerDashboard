-- Logos et favicons envoyés par fichier (marque de la plateforme, reseller_id
-- nul, ou d'un revendeur). Rangés en base, 512 Kio au plus, type lu dans les
-- octets (PNG, JPEG, WebP, ICO ; jamais de SVG) ; servis par l'interface sous
-- /brand/fichier/<id>. Une ligne n'est jamais modifiée : un envoi en crée une.
CREATE TABLE "brand_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reseller_id" uuid,
	"kind" varchar(16) NOT NULL,
	"content_type" varchar(32) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_images" ADD CONSTRAINT "brand_images_reseller_id_users_id_fk" FOREIGN KEY ("reseller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_images_owner_idx" ON "brand_images" USING btree ("reseller_id","kind");