-- Sonde de jeu déclarée par l'egg (clé `game_query` : protocole minecraft,
-- a2s ou cfx, variable du port de requête, décalage). Nulle pour les eggs
-- existants : la sonde reconnaît alors le jeu à son nom. Jamais servie à Wings.
ALTER TABLE "eggs" ADD COLUMN "game_query" jsonb;
