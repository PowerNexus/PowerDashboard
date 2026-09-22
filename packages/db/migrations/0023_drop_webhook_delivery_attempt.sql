-- Retire `attempt`, remplacée par `attempts` à la migration suivante.
--
-- Le fichier généré par drizzle-kit rejouait tout l'historique : ses
-- instantanés avaient dérivé des migrations écrites à la main, et il proposait
-- de recréer des tables déjà en service. Seule la ligne ci-dessous était
-- réellement nouvelle. L'instantané, lui, est désormais exact — c'est la
-- génération suivante qui en profitera.
ALTER TABLE "webhook_deliveries" DROP COLUMN IF EXISTS "attempt";
