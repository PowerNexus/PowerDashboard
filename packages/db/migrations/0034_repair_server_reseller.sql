-- Répare les rattachements perdus depuis la migration 0015.
--
-- La colonne `servers.reseller_id` a été ajoutée en 0014 et remplie une fois en
-- 0015, à partir du propriétaire de la machine. **Aucun code ne l'écrivait
-- ensuite.** Tout serveur créé depuis naissait donc sans rattachement, y
-- compris sur le matériel d'un revendeur.
--
-- Trois mécanismes lisent cette colonne et ne se plaignaient de rien :
--
--   * l'enveloppe du revendeur, qui ne comptait qu'une consommation figée à la
--     date de la 0015 — son quota ne pouvait donc plus mordre ;
--   * la consommation de sa part sur une machine partagée, pour la même raison ;
--   * le périmètre de ses clés applicatives, qui rendait un parc vide.
--
-- La création écrit désormais le rattachement (`attributedReseller`). Cette
-- migration rattrape l'intervalle, avec exactement la règle de la 0015 : la
-- machine dit à qui le serveur appartenait.
--
-- Ce qu'elle ne peut pas rattraper, et c'est assumé : un serveur vendu par un
-- revendeur sur une **part** d'une machine de la plateforme. La machine n'a pas
-- de propriétaire, et rien d'autre en base ne dit qui l'a vendu — l'inventer
-- attribuerait des serveurs au hasard, ce qui est pire que de n'en attribuer
-- aucun. Ces serveurs restent à la plateforme et se corrigent depuis
-- l'administration.
--
-- `is null` en garde, comme en 0015 : repasser ne doit écraser aucun
-- rattachement posé depuis.

update "servers" s
set "reseller_id" = n."owner_id"
from "nodes" n
where s."node_id" = n."id"
  and n."owner_id" is not null
  and s."reseller_id" is null;
