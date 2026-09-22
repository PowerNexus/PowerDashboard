-- Rattache les serveurs existants au revendeur dont ils dépendaient.
--
-- Jusqu'ici, le rattachement se **déduisait** de la machine : un serveur qui
-- tourne sur la machine de Paul est un serveur de Paul. Cette déduction cesse
-- d'être possible dès qu'une machine porte plusieurs revendeurs, d'où la
-- colonne. La recopier maintenant préserve exactement ce que l'ancienne règle
-- disait ; sans elle, tous les serveurs déjà en place repasseraient à la
-- plateforme et disparaîtraient de l'espace de leur revendeur.
--
-- `is null` en garde : la migration doit pouvoir repasser sans écraser un
-- rattachement posé depuis.

update "servers" s
set "reseller_id" = n."owner_id"
from "nodes" n
where s."node_id" = n."id"
  and n."owner_id" is not null
  and s."reseller_id" is null;
