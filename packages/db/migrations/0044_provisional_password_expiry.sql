-- Échéance des mots de passe provisoires (ASVS 2.3.1).
--
-- Posée par les scripts d'exploitation (`create-admin`, `reset-password`)
-- quand ils tirent un mot de passe au sort ; nulle pour tout mot de passe
-- choisi. Passé l'échéance, la connexion le refuse ; avant, elle demande d'en
-- changer. Tout changement de mot de passe depuis le panel la lève.
--
-- Colonne nullable, sans valeur par défaut : aucun mot de passe existant ne
-- devient provisoire, et l'ajout ne réécrit pas la table.
ALTER TABLE "users" ADD COLUMN "password_expires_at" timestamp with time zone;