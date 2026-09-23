-- Suspension d'un compte par l'administration.
--
-- Un horodatage plutôt qu'un booléen : « depuis quand » est la première
-- question du support. La suspension ferme toutes les portes du compte
-- (sessions, clés d'API, SFTP, liens de la facturation) mais laisse ses
-- serveurs tourner : suspendre un serveur est un autre geste.
--
-- Colonnes nullables, sans valeur par défaut : aucun compte existant n'est
-- suspendu, et l'ajout ne réécrit pas la table.
ALTER TABLE "users" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "suspension_reason" text;
