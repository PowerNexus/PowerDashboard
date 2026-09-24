-- Unicité de l'adresse insensible à la casse (NC-28).
--
-- `users_email_unique` portait sur la colonne brute : « Paul@ex.fr » et
-- « paul@ex.fr » passaient pour deux adresses, alors que toutes les lectures
-- — connexion, rapprochement SSO, invitations — comparent en `lower()` et
-- prennent la première ligne venue. L'index passe sur `lower(email)`.
--
-- Des doublons de casse peuvent déjà exister : `create-admin.mts` compare
-- l'adresse telle quelle, le SSO réalignait un compte sur l'adresse du
-- fournisseur sans la mettre en minuscules, et deux inscriptions simultanées
-- passent toutes deux le contrôle préalable. Sur une telle base, créer
-- l'index échouerait et arrêterait la livraison — pire que le défaut. La
-- migration garde alors l'ancien index, le dit dans le journal du déploiement
-- (WARNING) avec la marche à suivre, et ne fusionne ni ne renomme aucun
-- compte d'office : deux comptes pour une adresse sont deux titulaires
-- possibles, et seul un humain peut dire lequel la garde.
--
-- Les adresses existantes ne sont pas réécrites : l'index compare en
-- minuscules, et changer l'adresse affichée d'un compte n'apporterait rien.
DO $$
DECLARE
  doublons bigint;
BEGIN
  SELECT count(*) INTO doublons
    FROM (SELECT 1 FROM "users" GROUP BY lower("email") HAVING count(*) > 1) AS d;

  IF doublons > 0 THEN
    RAISE WARNING
      'users_email_unique reste sensible à la casse : % adresse(s) portée(s) par plusieurs comptes. Les lister : SELECT lower(email), array_agg(email) FROM users GROUP BY 1 HAVING count(*) > 1; changer l''adresse de tous les comptes sauf un, puis : DROP INDEX "users_email_unique"; CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));',
      doublons;
    RETURN;
  END IF;

  DROP INDEX "users_email_unique";
  CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));
END $$;
