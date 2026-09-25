-- Adresse de réponse des courriels d'un revendeur (`Reply-To`).
-- Le courrier part toujours de l'adresse SMTP de la plateforme : seuls le nom
-- affiché et la réponse changent, pour ne pas casser SPF et DKIM.
ALTER TABLE "reseller_brandings" ADD COLUMN "reply_to" varchar(254) DEFAULT '' NOT NULL;
