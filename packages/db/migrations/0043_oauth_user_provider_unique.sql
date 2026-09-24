-- Une identité par fournisseur et par compte (doute D-7 de l'audit).
--
-- Le rapprochement SSO refusait de lier un compte à une seconde identité du
-- même fournisseur, mais par une lecture suivie d'une écriture : deux
-- cérémonies concurrentes lisaient toutes deux « aucune liaison » et
-- écrivaient chacune la sienne. L'index tranche désormais, et le service
-- relit après une insertion refusée.
--
-- La course a pu laisser de tels doublons. Sur une base qui en porte, créer
-- l'index échouerait et arrêterait la livraison — pire que le défaut. La
-- migration n'en pose alors aucun, le dit dans le journal du déploiement
-- (WARNING) avec la marche à suivre, et ne supprime aucune liaison d'office :
-- laquelle garder, c'est savoir à qui appartient le compte.
DO $$
DECLARE
  doublons bigint;
BEGIN
  SELECT count(*) INTO doublons
    FROM (
      SELECT 1 FROM "user_oauth_accounts" GROUP BY "user_id", "provider" HAVING count(*) > 1
    ) AS d;

  IF doublons > 0 THEN
    RAISE WARNING
      'oauth_user_provider_unique non créé : % compte(s) liés à plusieurs identités d''un même fournisseur. Les lister : SELECT user_id, provider, array_agg(provider_user_id) FROM user_oauth_accounts GROUP BY 1, 2 HAVING count(*) > 1; supprimer les liaisons en trop, puis : CREATE UNIQUE INDEX "oauth_user_provider_unique" ON "user_oauth_accounts" USING btree ("user_id","provider");',
      doublons;
    RETURN;
  END IF;

  CREATE UNIQUE INDEX "oauth_user_provider_unique" ON "user_oauth_accounts" USING btree ("user_id","provider");
END $$;
