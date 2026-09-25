-- Alerte quand un serveur tombe ou revient.
--
-- `unreachable_since` est posée par la sonde de jeu après trois sondes
-- manquées d'affilée sur un serveur censé tourner, et levée à la première
-- réponse. Sa transition déclenche la notification.
ALTER TABLE "servers" ADD COLUMN "unreachable_since" timestamp with time zone;
