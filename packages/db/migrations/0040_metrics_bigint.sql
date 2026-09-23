-- Mesures des serveurs en entiers 64 bits.
--
-- `mem_bytes`, `disk_bytes`, `net_rx` et `net_tx` étaient des `integer` :
-- plafond 2 147 483 647, soit 2 Gio. Un serveur ordinaire le dépasse en disque
-- dès son premier monde, et ses compteurs réseau cumulés en quelques heures.
-- L'insertion du collecteur échouait alors, l'échec partait au journal en
-- `debug`, et aucune ligne n'était écrite : ces serveurs n'avaient pas
-- d'historique, sans que rien ne le signale.
--
-- Élargir un `integer` en `bigint` ne perd aucune valeur. PostgreSQL réécrit
-- la table sous verrou exclusif : sur trente jours de relevés, compter
-- quelques secondes pendant lesquelles le collecteur attend son tour.

ALTER TABLE "server_metrics" ALTER COLUMN "mem_bytes" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "server_metrics" ALTER COLUMN "disk_bytes" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "server_metrics" ALTER COLUMN "net_rx" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "server_metrics" ALTER COLUMN "net_tx" SET DATA TYPE bigint;