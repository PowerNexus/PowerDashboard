-- L'état du certificat TLS d'un domaine de revendeur.
--
-- Le panel reconnaissait un domaine vérifié sans pouvoir lui délivrer de
-- certificat : cela demande le serveur web et les droits de root, qui ne sont
-- pas de son ressort. L'écran le disait honnêtement, et s'arrêtait là — le
-- revendeur voyait « vérifié » et ses clients un avertissement de sécurité.
--
-- Un agent tourne désormais sur le serveur web (`infra/prod/certificates.sh`)
-- et fait le pont. Ces colonnes sont ce qu'il rend : de quoi afficher où en est
-- chaque domaine, et **pourquoi** quand cela ne passe pas.
--
-- `certificate_failure` porte une phrase, pas un journal. Recopier la sortie
-- d'ACME n'aiderait personne : ce qu'il faut savoir, c'est à qui est le
-- problème — au revendeur qui n'a pas pointé sa zone, à la plateforme dont le
-- serveur web a refusé, ou à l'autorité qui limite le débit.
--
-- Les quatre colonnes sont nullables, et aucune ne se déduit d'une autre :
-- un domaine peut avoir un certificat **et** un échec (le renouvellement a
-- échoué mais l'ancien tient encore), ce qui est précisément le moment où il
-- faut prévenir.

ALTER TABLE "reseller_brandings" ADD COLUMN IF NOT EXISTS "certificate_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reseller_brandings" ADD COLUMN IF NOT EXISTS "certificate_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reseller_brandings" ADD COLUMN IF NOT EXISTS "certificate_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reseller_brandings" ADD COLUMN IF NOT EXISTS "certificate_failure" text;
