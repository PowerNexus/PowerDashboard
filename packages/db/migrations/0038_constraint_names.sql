-- Contraintes renommées au nom que drizzle leur donne.
--
-- Les migrations 0018 (jetons d'authentification), 0020 (marque des
-- revendeurs) et 0022 (prise en main) ont été écrites à la main, avec des
-- `references` et des `unique` en ligne. PostgreSQL a donc nommé ces
-- contraintes à sa façon (`*_fkey`, `*_key`), et non comme le schéma drizzle
-- les nomme (`*_users_id_fk`, `*_unique`).
--
-- Rien ne cassait aujourd'hui, et c'est ce qui rendait l'écart dangereux : la
-- première migration générée qui toucherait l'une de ces contraintes ferait
-- `DROP CONSTRAINT "auth_tokens_user_id_users_id_fk"` sur une base où elle
-- s'appelle autrement, et échouerait en pleine livraison.
--
-- Chaque renommage n'a lieu que si l'ancien nom existe : la migration est
-- rejouable, et sans effet sur une base qui porterait déjà les bons noms.
-- Renommer une contrainte d'unicité renomme aussi l'index qui la porte.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('auth_tokens',        'auth_tokens_user_id_fkey',         'auth_tokens_user_id_users_id_fk'),
      ('reseller_brandings', 'reseller_brandings_user_id_fkey',  'reseller_brandings_user_id_users_id_fk'),
      ('reseller_brandings', 'reseller_brandings_user_id_key',   'reseller_brandings_user_id_unique'),
      ('reseller_brandings', 'reseller_brandings_domain_key',    'reseller_brandings_domain_unique'),
      ('sessions',           'sessions_impersonator_id_fkey',    'sessions_impersonator_id_users_id_fk')
    ) AS t(tbl, ancien, nouveau)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = r.ancien AND conrelid = format('public.%I', r.tbl)::regclass
    ) THEN
      EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', r.tbl, r.ancien, r.nouveau);
    END IF;
  END LOOP;
END $$;
