-- Identifiant du téléversement fractionné en cours.
--
-- Un dépôt S3 de plusieurs gigaoctets se fait en parties, et le service rend un
-- identifiant qu'il faut lui redonner pour recoller les morceaux — ou pour les
-- jeter. Wings ne le connaît pas : il reçoit des adresses signées et rapporte
-- des empreintes de parties. C'est donc au panel de le retenir.
--
-- Nul pour une sauvegarde locale, et pour une sauvegarde distante déjà close :
-- la colonne dit « un dépôt est en cours », pas « cette sauvegarde est
-- distante » — ce que `disk` dit déjà.
alter table "backups"
  add column if not exists "upload_id" text;
