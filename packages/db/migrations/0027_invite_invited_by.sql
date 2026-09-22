-- Qui a émis l'invitation.
--
-- La colonne sert à l'affichage — on n'accepte pas un pouvoir offert par un
-- inconnu — et surtout au contrôle d'acceptation : les permissions sont
-- scellées à l'émission, et il faut pouvoir vérifier que leur auteur les
-- détient encore quand le lien est ouvert, parfois plusieurs jours après.
--
-- `on delete set null` plutôt qu'une cascade : la suppression d'un compte ne
-- doit pas faire disparaître une invitation en cours, qui ne lui appartient
-- plus une fois envoyée. Le nom s'efface, l'invitation reste vérifiable — et
-- devient caduque au contrôle, puisqu'un auteur inconnu ne détient rien.
ALTER TABLE "server_invites" ADD COLUMN IF NOT EXISTS "invited_by" uuid;--> statement-breakpoint
ALTER TABLE "server_invites" DROP CONSTRAINT IF EXISTS "server_invites_invited_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "server_invites" ADD CONSTRAINT "server_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
