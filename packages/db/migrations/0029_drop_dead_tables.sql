-- Trois tables que rien n'écrit, ne lit, et ne peut remplir.
--
-- Une table déclarée est une promesse : elle dit qu'une fonction existe, ou
-- qu'elle est en route. Celles-ci n'ont jamais reçu une ligne, et chacune a
-- une raison différente de ne jamais en recevoir.
--
-- * `backup_schedules` — un second moyen de planifier des sauvegardes, avec sa
--   propre rétention et sa propre liste d'exclusions. Le planificateur général
--   le fait déjà par une tâche d'action « backup ». Deux mécanismes pour la
--   même chose, dont un seul tourne.
--
-- * `node_metrics` — la charge de la **machine**, par opposition à ce que ses
--   conteneurs consomment. Wings ne l'expose pas : son `/api/system` ne rend
--   que l'architecture, le noyau et la version. Le panel ne modifiant pas
--   Wings, cette table ne peut pas être remplie. `server_metrics`, qui mesure
--   les conteneurs, est alimentée et suffit à ce que les écrans affichent.
--
-- * `marketplace_sources` — les sources du catalogue en base, avec un réglage
--   par source. Elles sont en dur dans le code, et la seule qui demandait une
--   configuration — la clé CurseForge — a désormais son réglage de plateforme.
--
-- `user_oauth_accounts` n'est **pas** supprimée : elle est vide comme les
-- autres, mais le plan la prévoit pour plusieurs fournisseurs d'identité, et
-- c'est l'implémentation actuelle qui a divergé en logeant l'identifiant
-- externe dans une colonne de `users`.
--
-- Le garde-fou ci-dessous refuse la suppression d'une table qui aurait reçu
-- des lignes depuis : le déploiement s'arrête alors au lieu de les perdre.
DO $$
DECLARE
  cible text;
  restant bigint;
BEGIN
  FOREACH cible IN ARRAY ARRAY['backup_schedules', 'node_metrics', 'marketplace_sources'] LOOP
    IF to_regclass('public.' || cible) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('SELECT count(*) FROM %I', cible) INTO restant;
    IF restant > 0 THEN
      RAISE EXCEPTION
        'La table % porte % ligne(s) : suppression refusée. Quelqu''un l''emploie — vérifiez avant de retirer cette migration.',
        cible, restant;
    END IF;

    EXECUTE format('DROP TABLE %I', cible);
  END LOOP;
END $$;
