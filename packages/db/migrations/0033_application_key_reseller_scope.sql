-- Une clé applicative peut désormais être bornée à un revendeur.
--
-- Jusqu'ici une clé portait des **portées sans périmètre** : elle disait ce
-- qu'on pouvait faire, jamais sur qui. Dans un panel qui pratique la revente,
-- cela rendait impossible ce qu'on attend pourtant de lui — qu'un revendeur
-- branche sa propre boutique. Lui remettre une clé revenait à lui donner la
-- main sur les clients des autres revendeurs et sur ceux de la plateforme,
-- avec, sous la portée `users.sso`, le moyen d'ouvrir une session au nom de
-- n'importe lequel d'entre eux.
--
-- `null` conserve le comportement d'avant : la clé vaut pour toute la
-- plateforme. Les clés existantes ne changent donc pas de portée, ce qui est la
-- seule migration acceptable sur des jetons en service.
--
-- `on delete cascade` : un revendeur supprimé emporte ses clés. Les laisser
-- vivre ferait des jetons dont le périmètre ne désigne plus personne — lu
-- « aucun client » à un endroit, « tous » à un autre, et c'est la seconde
-- lecture qui fait les incidents.
ALTER TABLE "application_keys" ADD COLUMN IF NOT EXISTS "reseller_id" uuid;--> statement-breakpoint
ALTER TABLE "application_keys" DROP CONSTRAINT IF EXISTS "application_keys_reseller_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "application_keys" ADD CONSTRAINT "application_keys_reseller_id_users_id_fk" FOREIGN KEY ("reseller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "application_keys_reseller_idx" ON "application_keys" USING btree ("reseller_id");
