-- Commandes de la vue joueurs déclarées par l'egg (clé `player_commands`).
-- Vide pour les eggs existants : le panel retombe alors sur les commandes du
-- jeu reconnu (Minecraft). Jamais servies à Wings.
ALTER TABLE "eggs" ADD COLUMN "player_commands" jsonb DEFAULT '{}'::jsonb NOT NULL;
