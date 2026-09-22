-- Prise en main d'un compte par le personnel.
--
-- La session reste **celle du client** : `user_id` ne change pas, et tout le
-- contrôle d'accès existant continue donc de s'appliquer sans qu'une seule
-- route ait à savoir qu'une prise en main est en cours. C'est ce qui rend le
-- mécanisme sûr : il n'y a pas de chemin parallèle à tenir à jour.
--
-- Cette colonne dit seulement **qui a ouvert la session**. Nulle dans le cas
-- courant, et c'est l'immense majorité des lignes : une session ordinaire n'a
-- pas d'emprunteur.
--
-- `set null` à la suppression du compte du personnel plutôt que `cascade` :
-- effacer un agent ne doit pas emporter la session d'un client, qui n'y est
-- pour rien.
alter table "sessions"
  add column if not exists "impersonator_id" uuid references "users"("id") on delete set null;

-- Les sessions ouvertes par emprunt se retrouvent par cette colonne — pour les
-- couper toutes d'un coup, ou pour répondre à « qui est entré chez qui ».
create index if not exists "session_impersonator_idx"
  on "sessions" ("impersonator_id")
  where "impersonator_id" is not null;
