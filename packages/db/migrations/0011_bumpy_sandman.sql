CREATE TABLE "node_categories" (
	"id" varchar(60) PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "node_subcategories" (
	"id" varchar(60) PRIMARY KEY NOT NULL,
	"category_id" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "node_subcategories" ADD CONSTRAINT "node_subcategories_category_id_node_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."node_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "node_category_position_idx" ON "node_categories" USING btree ("position");--> statement-breakpoint
CREATE INDEX "node_subcategory_category_idx" ON "node_subcategories" USING btree ("category_id","position");