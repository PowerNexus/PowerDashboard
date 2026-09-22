-- Jetons envoyés par courrier : réinitialisation de mot de passe, vérification
-- d'adresse.
--
-- Une table plutôt qu'un jeton signé auto-porteur, et pour une raison précise :
-- un jeton signé ne se révoque pas. Celui qui réinitialise un mot de passe doit
-- cesser de valoir dès qu'il a servi — sinon un courriel oublié dans une boîte
-- reste une clé du compte pendant des mois — et doit tomber en même temps que
-- ses frères quand on en redemande un.
--
-- Seul le condensat est conservé, comme pour les sessions : une fuite de la
-- table ne doit pas donner de quoi prendre un compte.
create table if not exists "auth_tokens" (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" uuid not null references "users"("id") on delete cascade,
  "purpose" varchar(32) not null,
  "token_hash" text not null,
  "expires_at" timestamptz not null,
  -- Non nul dès que le jeton a servi. La ligne reste : « déjà utilisé » et
  -- « jamais existé » appellent deux messages différents.
  "consumed_at" timestamptz,
  "requested_ip" inet,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

-- La recherche se fait toujours par condensat : l'index porte donc sur une
-- valeur qui ne vaut rien si la table fuite.
create unique index if not exists "auth_tokens_hash_unique" on "auth_tokens" ("token_hash");
create index if not exists "auth_tokens_user_idx" on "auth_tokens" ("user_id", "purpose");
