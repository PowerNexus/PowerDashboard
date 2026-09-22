-- Clés d'amorçage pour `wings configure`.
--
-- Trois colonnes plutôt qu'une table à part : c'est la même authentification,
-- la même garde et le même préfixe `yh_app_`. Ce qui change est la durée de
-- vie et l'étendue, et ces deux-là se disent bien par des colonnes.
--
-- Additif et rejouable : les clés existantes restent ce qu'elles sont —
-- `node_id` nul vaut « tout le parc », `single_use` faux vaut « autant de fois
-- que voulu », ce qui est exactement leur comportement d'aujourd'hui.

ALTER TABLE "application_keys" ADD COLUMN IF NOT EXISTS "node_id" uuid;
ALTER TABLE "application_keys" ADD COLUMN IF NOT EXISTS "single_use" boolean DEFAULT false NOT NULL;
ALTER TABLE "application_keys" ADD COLUMN IF NOT EXISTS "consumed_at" timestamptz;

CREATE INDEX IF NOT EXISTS "application_key_node_idx" ON "application_keys" ("node_id");
