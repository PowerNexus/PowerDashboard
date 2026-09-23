-- Taille des sauvegardes en entier 64 bits.
--
-- `backups.bytes` était un `integer` : plafond 2 147 483 647, soit 2 Gio, la
-- même limite que corrigeait 0040 pour les mesures. Le compte rendu d'une
-- archive plus grosse échouait en base ; faute d'accusé de réception, Wings
-- effaçait l'archive, et la sauvegarde restait « en cours » sans rien derrière.
--
-- Élargir un `integer` en `bigint` ne perd aucune valeur. La table des
-- sauvegardes est petite : la réécriture sous verrou est immédiate.

ALTER TABLE "backups" ALTER COLUMN "bytes" SET DATA TYPE bigint;
