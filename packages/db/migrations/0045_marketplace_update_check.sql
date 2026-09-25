-- Veille des mises à jour du marketplace.
--
-- `name` garde le nom du projet pour lister les extensions installées sans
-- interroger les catalogues ; `latest_version` et `checked_at` portent le
-- dernier relevé de la veille (null : à jour, ou pas encore vérifié).
ALTER TABLE "marketplace_installs" ADD COLUMN "name" varchar(200) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "marketplace_installs" ADD COLUMN "latest_version" varchar(120);--> statement-breakpoint
ALTER TABLE "marketplace_installs" ADD COLUMN "checked_at" timestamp with time zone;
