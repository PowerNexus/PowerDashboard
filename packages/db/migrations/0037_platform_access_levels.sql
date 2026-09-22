-- Ce que le revendeur laisse la plateforme faire sur son parc, à trois niveaux.
--
-- Le réglage était un booléen : « autoriser l'administration à créer des
-- serveurs sur mon compte ». Il ne bloquait que la création. Un administrateur
-- gardait, quoi qu'il arrive, le contrôle complet de tous les serveurs du
-- revendeur — console, fichiers, alimentation, suppression. Le revendeur
-- croyait fermer une porte ; il n'en fermait qu'une sur trois.
--
-- Les trois niveaux, du plus ouvert au plus fermé :
--
--   provision  L'administration crée sur son compte et gère ses serveurs.
--   read_only  Elle regarde, elle n'agit pas. Ni console, ni fichiers, ni
--              alimentation, ni création.
--   none       Elle ne voit rien : les serveurs de ce revendeur disparaissent
--              aussi des écrans d'administration.
--
-- **La reprise met les revendeurs existants en `read_only`**, et c'est un
-- resserrement assumé. Leur booléen à « refusé » ne disait rien de la lecture
-- ni de la gestion ; le lire comme « provision » aurait conservé un accès
-- complet que le nouveau réglage annonce désormais fermé — l'écran mentirait
-- dès sa première ouverture. Ceux qui avaient explicitement autorisé la
-- création gardent `provision` : eux avaient dit oui.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "platform_access" varchar(16) NOT NULL DEFAULT 'read_only';--> statement-breakpoint

UPDATE "users"
   SET "platform_access" = 'provision'
 WHERE "allows_platform_provisioning" = true;--> statement-breakpoint

-- L'ancienne colonne est retirée plutôt que laissée en place.
--
-- Une colonne qui n'est plus lue mais qui porte encore un nom crédible est un
-- piège : la prochaine lecture la croira autoritaire. Sa valeur est déjà
-- reportée ci-dessus.
ALTER TABLE "users" DROP COLUMN IF EXISTS "allows_platform_provisioning";
