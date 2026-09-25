-- Domaine relais des clés d'accès : `null` pour celui de la plateforme, le
-- domaine vérifié d'un revendeur sinon. Les clés existantes ont toutes été
-- créées sur le domaine de la plateforme : `null` leur convient.
ALTER TABLE "user_passkeys" ADD COLUMN "rp_id" varchar(255);
