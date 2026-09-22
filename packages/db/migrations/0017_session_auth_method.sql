-- Comment une session a-t-elle été ouverte ?
--
-- Le panel savait *qui* était connecté, jamais *par quel chemin*. La question
-- se pose pourtant tous les jours : quelqu'un qui s'est connecté par son compte
-- Google cherchera en vain son mot de passe, et un compte entré par SSO n'a
-- parfois aucun mot de passe à changer. L'afficher suppose de l'avoir consigné
-- au moment où on le savait — c'est-à-dire ici, à l'ouverture.
--
-- `password` par défaut : c'est ce qu'étaient toutes les sessions existantes au
-- moment de cette migration, le SSO et les clés d'accès étant arrivés après.
-- Une valeur nulle aurait voulu dire « on ne sait pas », ce qui est faux.
alter table "sessions"
  add column if not exists "auth_method" varchar(32) not null default 'password';
