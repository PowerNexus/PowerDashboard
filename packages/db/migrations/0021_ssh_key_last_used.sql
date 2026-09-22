-- Dernier emploi d'une clé SSH.
--
-- Une clé qui n'a jamais servi et une clé employée hier n'appellent pas la
-- même décision : la première se retire sans risque, la seconde est en service.
-- Sans cette colonne, l'écran ne peut proposer que « supprimer », sans dire ce
-- qu'on casse.
--
-- Nulle par défaut, et c'est la bonne valeur : les clés déjà enregistrées
-- n'ont pas d'historique, et inventer une date ferait croire à un usage.
alter table "ssh_keys" add column if not exists "last_used_at" timestamptz;
